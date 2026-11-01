import { BuiltBy } from '@/components/BuiltBy';

export function AppBrand({ heading = 'h1' }: { heading?: 'h1' | 'div' }) {
  const Heading = heading;
  return <div className="app-brand">
    <Heading className="brand-heading"><img className="brand-logo" src="/brands/grantfin.png" alt="GrantFin" width="240" height="76" /></Heading>
    <p>Find funding. Keep the evidence.{' '}<span className="brand-powered">Powered by Microsoft Fabric and Rayfin.</span></p>
  </div>;
}

export function AppFooter() {
  return <footer className="app-footer"><div className="site-width footer-inner">
    <span>Independent prototype · Not an official government service. Confirm details with the issuing agency.</span><BuiltBy />
  </div></footer>;
}
