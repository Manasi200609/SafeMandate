import { useTranslation } from 'react-i18next';
import { ArrowLeft, CircleSlash, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageFrame from '../components/PageFrame.jsx';

export default function PaypalCallbackPage({ outcome = 'return' }) {
  const { t } = useTranslation();
  const canceled = outcome === 'cancel';
  const Icon = canceled ? CircleSlash : Clock3;

  return (
    <PageFrame className="app-page">
      <div className="page-shell subpage-shell">
        <div className="demo-ribbon" role="status">
          <span className="demo-pulse" />
          {t('paypalCallback.unverified')}
        </div>
        <section className="empty-screen paypal-callback" aria-labelledby="paypal-callback-title">
          <Icon size={28} aria-hidden="true" />
          <span className="eyebrow">
            {t(canceled ? 'paypalCallback.cancelEyebrow' : 'paypalCallback.returnEyebrow')}
          </span>
          <h1 id="paypal-callback-title">
            {t(canceled ? 'paypalCallback.cancelTitle' : 'paypalCallback.returnTitle')}
          </h1>
          <p>
            {t(canceled ? 'paypalCallback.cancelBody' : 'paypalCallback.returnBody')}
          </p>
          <Link className="button button-outline" to="/">
            <ArrowLeft size={14} aria-hidden="true" />
            {t('paypalCallback.home')}
          </Link>
        </section>
      </div>
    </PageFrame>
  );
}
