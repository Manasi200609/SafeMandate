export function createAiAssessmentController(aiAssessmentService) {
  return Object.freeze({
    async assess(req, res) {
      const result = await aiAssessmentService.assess({ principal: req.principal, body: req.body });
      res.set('Cache-Control', 'no-store');
      return res.status(200).json(result);
    },
  });
}
