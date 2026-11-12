import { createHash, randomUUID } from 'node:crypto';
import { evaluateProposal } from '../domain/mandate/evaluateProposal.js';
import { CURRENCY_MINOR_UNITS } from '../domain/mandate/currencies.js';
import { validateAssessment } from '../integrations/ai/validateAssessment.js';
import { AiConfigurationError, AiProviderError } from '../integrations/ai/openAiCompatibleProvider.js';
import { ApiError } from '../middleware/errors.js';
import { sanitizeAiText } from '../integrations/ai/sanitizeAiInput.js';

const PROMPT_VERSION = 'purchase-copilot-v1';
const MAX_TEXT_LENGTH = 8000;
const OWN_PROPOSAL_FIELDS = Object.freeze(['itemName', 'amountMinor', 'category', 'meetupLocation', 'locationIsPublic', 'proposedLocalMeetupTime']);

export function createAiAssessmentService({ repositories, transactionService, providerFactory, now = () => new Date() }) {
  function currentTime() { return now().toISOString(); }

  function requireBuyer(principal) {
    if (principal?.role !== 'buyer') throw new ApiError(403, 'ROLE_NOT_PERMITTED', 'Only an authenticated buyer may request a purchase assessment.');
  }

  function validateConversation(value) {
    if (value !== undefined && (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH)) {
      throw new ApiError(400, 'AI_INPUT_INVALID', 'Seller conversation must be text no longer than 8,000 characters.');
    }
    return (value ?? '').trim();
  }

  function validateStandaloneBody(body) {
    const keys = ['listingText', 'conversationText', 'purchase'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !keys.includes(key))) {
      throw new ApiError(400, 'AI_INPUT_INVALID', 'Provide listingText, optional conversationText, and structured purchase details only.');
    }
    if (typeof body.listingText !== 'string' || body.listingText.trim().length < 10 || body.listingText.length > MAX_TEXT_LENGTH) {
      throw new ApiError(400, 'AI_INPUT_INVALID', 'Listing text must contain 10 to 8,000 characters.');
    }
    const purchase = body.purchase;
    if (!purchase || typeof purchase !== 'object' || Array.isArray(purchase)
      || Object.keys(purchase).length !== OWN_PROPOSAL_FIELDS.length
      || Object.keys(purchase).some((key) => !OWN_PROPOSAL_FIELDS.includes(key))) {
      throw new ApiError(400, 'AI_INPUT_INVALID', 'Structured purchase details are incomplete or contain unsupported fields.');
    }
    if (typeof purchase.itemName !== 'string' || purchase.itemName.trim().length < 1 || purchase.itemName.length > 180
      || !Number.isSafeInteger(purchase.amountMinor) || purchase.amountMinor <= 0
      || typeof purchase.category !== 'string' || purchase.category.trim().length < 1 || purchase.category.length > 80
      || typeof purchase.meetupLocation !== 'string' || purchase.meetupLocation.trim().length < 1 || purchase.meetupLocation.length > 180
      || typeof purchase.locationIsPublic !== 'boolean'
      || typeof purchase.proposedLocalMeetupTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(purchase.proposedLocalMeetupTime)) {
      throw new ApiError(400, 'AI_INPUT_INVALID', 'Structured purchase details contain invalid values.');
    }
    return { listingText: body.listingText.trim(), purchase: { ...purchase } };
  }

  async function loadContext({ principal, body }) {
    if (typeof body?.transactionId === 'string' && body.transactionId.trim()) {
      if (Object.keys(body).some((key) => !['transactionId', 'conversationText'].includes(key))) {
        throw new ApiError(400, 'AI_INPUT_INVALID', 'For a saved transaction, send only transactionId and optional conversationText.');
      }
      const context = await transactionService.getPaymentContext(body.transactionId.trim());
      if (context.record.buyerId !== principal.userId) throw new ApiError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
      const listingText = context.record.proposal.description;
      if (typeof listingText !== 'string' || listingText.trim().length < 10 || listingText.length > MAX_TEXT_LENGTH) {
        throw new ApiError(409, 'AI_LISTING_UNAVAILABLE', 'The stored transaction does not contain listing text for analysis.');
      }
      return {
        listingText: listingText.trim(),
        conversationText: validateConversation(body.conversationText),
        proposal: context.record.proposal,
        mandate: context.record.mandate,
        transactionId: context.record.transactionId,
      };
    }

    const input = validateStandaloneBody(body);
    const conversationText = validateConversation(body.conversationText);
    const mandateRecord = await repositories.mandates.findCurrentForBuyer(principal.userId);
    if (!mandateRecord?.payload) throw new ApiError(409, 'MANDATE_REQUIRED', 'Save a purchase mandate before using the copilot.');
    const mandate = mandateRecord.payload;
    const proposal = {
      ...input.purchase,
      proposalId: `ai_preview_${randomUUID()}`,
      description: input.listingText,
      currency: mandate.currency,
      timeZone: mandate.meetupRules?.timeZone,
      createdAt: currentTime(),
    };
    return { listingText: input.listingText, conversationText, proposal, mandate, transactionId: null };
  }

  async function assess({ principal, body }) {
    requireBuyer(principal);
    const context = await loadContext({ principal, body });
    const evaluatedAt = currentTime();
    const policy = evaluateProposal(context.mandate, context.proposal, evaluatedAt);
    let provider;
    try { provider = providerFactory(); }
    catch (error) {
      if (error instanceof AiConfigurationError) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'The purchase copilot is not configured on this server.');
      throw error;
    }
    const purchaseContext = {
      itemName: context.proposal.itemName,
      category: context.proposal.category,
      askingPrice: { amountMinor: context.proposal.amountMinor, currency: context.proposal.currency },
      description: sanitizeAiText(context.proposal.description),
      proposedHandoff: {
        location: context.proposal.meetupLocation,
        publicPlace: context.proposal.locationIsPublic,
        localTime: context.proposal.proposedLocalMeetupTime,
        timeZone: context.proposal.timeZone,
      },
    };
    let providerResult;
    try {
      providerResult = await provider.analyze({
        listingText: sanitizeAiText(context.listingText),
        conversationText: sanitizeAiText(context.conversationText),
        purchaseContext,
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        if (error.code === 'AI_TIMEOUT') throw new ApiError(504, 'AI_PROVIDER_TIMEOUT', 'The purchase copilot timed out. Please try again.');
        if (error.code === 'AI_RATE_LIMITED') throw new ApiError(503, 'AI_PROVIDER_RATE_LIMITED', 'The purchase copilot is temporarily rate limited.');
        throw new ApiError(502, error.code === 'AI_INVALID_RESPONSE' ? 'AI_INVALID_RESPONSE' : 'AI_PROVIDER_UNAVAILABLE', 'The purchase copilot could not complete this assessment.');
      }
      throw error;
    }
    const assessment = validateAssessment(providerResult?.assessment, {
      listingText: context.listingText,
      conversationText: context.conversationText,
      askingAmountMinor: context.proposal.amountMinor,
      askingCurrency: context.proposal.currency,
    });
    if (!assessment) throw new ApiError(502, 'AI_INVALID_RESPONSE', 'The purchase copilot returned an invalid assessment. Please retry later.');

    const assessmentId = `aiassess_${randomUUID()}`;
    const digest = createHash('sha256').update(JSON.stringify({
      listingText: context.listingText,
      conversationText: context.conversationText,
      purchaseContext,
    })).digest('hex');
    const audit = {
      assessmentId,
      buyerId: principal.userId,
      transactionId: context.transactionId,
      provider: providerResult.provider ?? provider.provider ?? 'openai-compatible',
      model: providerResult.model ?? provider.model,
      promptVersion: providerResult.promptVersion ?? provider.promptVersion ?? PROMPT_VERSION,
      inputDigest: digest,
      riskLevel: assessment.riskLevel,
      recommendation: assessment.recommendation.nextStep,
      policyDecision: policy.decision,
      createdAt: evaluatedAt,
    };
    await repositories.aiAssessmentAudits.insert(audit);

    return {
      assessmentId,
      provider: audit.provider,
      model: audit.model,
      promptVersion: audit.promptVersion,
      assessment,
      purchaseDetails: {
        itemName: context.proposal.itemName,
        amountMinor: context.proposal.amountMinor,
        currency: context.proposal.currency,
        category: context.proposal.category,
      },
      policyEvaluation: {
        decision: policy.decision,
        reasonCodes: policy.reasonCodes,
        explanation: policy.explanation,
        requiresGuardianApproval: policy.requiresGuardianApproval,
        paymentEligible: policy.paymentEligible,
        evaluatedAt,
        source: context.transactionId ? 'persisted_transaction' : 'persisted_mandate_and_buyer_input',
        evaluationOnly: true,
        authorizationGranted: false,
      },
    };
  }

  return Object.freeze({ assess });
}
