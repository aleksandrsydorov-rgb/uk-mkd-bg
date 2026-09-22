import Image from 'next/image';

export function LocationDiagram({
  address,
  mapsLabel,
  mapsHref,
}: {
  address: string;
  mapsLabel: string;
  mapsHref: string;
}) {
  return (
    <div className="home-loc-map">
      <div className="home-loc-map-canvas">
        <Image
          src="/complex/amadeus11-map.png"
          alt={address}
          fill
          className="home-loc-map-img"
          sizes="(max-width: 1024px) 100vw, 48vw"
        />
      </div>
      <div className="home-loc-map-footer">
        <span className="home-loc-map-address">{address}</span>
        <a
          className="home-loc-maps-link"
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {mapsLabel}
          <svg viewBox="0 0 24 24" className="home-loc-maps-arrow" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </div>
  );
}
