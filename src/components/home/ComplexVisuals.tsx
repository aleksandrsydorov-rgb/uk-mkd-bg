export function FacadeIllustration({ caption, place }: { caption: string; place: string }) {
  return (
    <div className="relative isolate overflow-hidden rounded-[18px] border border-border bg-pool shadow-card">
      <div className="absolute inset-0 bg-gradient-to-b from-[#cfe6ec] via-pool to-warm-light" />
      <div className="absolute right-[12%] top-[10%] h-16 w-16 rounded-full bg-warm/70" />
      <div className="absolute right-[10%] top-[8%] h-20 w-20 rounded-full bg-warm-light/50 blur-md" />
      <div className="absolute bottom-[22%] left-[8%] h-24 w-10 rounded-full bg-green/35" />
      <div className="absolute bottom-[20%] right-[10%] h-20 w-8 rounded-full bg-green/25" />
      <div className="relative mx-auto mt-10 w-[78%] max-w-sm">
        <div className="rounded-t-[12px] bg-warm px-2 pb-2 pt-3 shadow-card">
          <div className="mb-2 h-2 w-1/3 rounded-sm bg-warm-light/80 mx-auto" />
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-8 rounded-sm bg-warm-light/90 ring-1 ring-black/5">
                <div className="mt-4 h-3 rounded-b-sm bg-sea/25" />
              </div>
            ))}
          </div>
        </div>
        <div className="h-3 bg-warm/80" />
      </div>
      <div className="relative mx-auto mt-3 mb-8 h-10 w-[62%] rounded-[50%] bg-sea/80 shadow-inner">
        <div className="absolute inset-x-6 top-1 h-2 rounded-full bg-white/30" />
      </div>
      <div className="absolute bottom-4 left-4 rounded-lg bg-white/80 px-3 py-1.5 text-xs text-foreground backdrop-blur-sm">
        <div className="font-semibold tracking-[0.02em]">{caption}</div>
        <div className="text-muted">{place}</div>
      </div>
    </div>
  );
}

export function PoolIllustration() {
  return (
    <div className="relative min-h-[240px] overflow-hidden rounded-[18px] border border-border bg-accent md:min-h-[320px]">
      <div className="absolute inset-0 bg-gradient-to-br from-accent via-sea to-pool" />
      <div className="absolute -right-8 top-8 h-40 w-40 rounded-full bg-warm-light/20 blur-2xl" />
      <div className="absolute bottom-8 left-[12%] right-[12%] h-[46%] rounded-[48%] bg-pool/90">
        <div className="absolute inset-x-[18%] top-4 h-5 rounded-full bg-white/25" />
      </div>
      <div className="absolute bottom-10 left-[8%] h-16 w-6 rounded-full bg-green/50" />
      <div className="absolute bottom-12 right-[10%] h-12 w-5 rounded-full bg-green/40" />
      <div className="absolute left-[18%] top-[28%] h-8 w-16 rounded-md bg-warm-light/70" />
      <div className="absolute right-[22%] top-[32%] h-8 w-16 rounded-md bg-warm/50" />
    </div>
  );
}

export function AtmosphereCard({
  title,
  variant,
}: {
  title: string;
  variant: 'yard' | 'pool' | 'grounds' | 'facade';
}) {
  const bg =
    variant === 'pool'
      ? 'from-sea to-pool'
      : variant === 'grounds'
        ? 'from-green/50 to-surface-warm'
        : variant === 'facade'
          ? 'from-warm to-warm-light'
          : 'from-surface-warm to-pool';
  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-surface shadow-card">
      <div className={`relative h-36 bg-gradient-to-br ${bg}`}>
        {variant === 'pool' && (
          <div className="absolute inset-x-8 bottom-6 top-10 rounded-[50%] bg-pool/80" />
        )}
        {variant === 'facade' && (
          <div className="absolute inset-x-10 bottom-0 top-8 grid grid-cols-4 gap-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-sm bg-white/35" />
            ))}
          </div>
        )}
        {variant === 'yard' && (
          <>
            <div className="absolute bottom-4 left-6 h-16 w-24 rounded-md bg-warm/40" />
            <div className="absolute bottom-5 right-8 h-10 w-10 rounded-full bg-green/50" />
          </>
        )}
        {variant === 'grounds' && (
          <>
            <div className="absolute bottom-6 left-8 h-12 w-20 rounded-full bg-green/60" />
            <div className="absolute bottom-8 right-10 h-8 w-14 rounded-full bg-green/40" />
          </>
        )}
      </div>
      <div className="px-4 py-3 text-sm font-medium">{title}</div>
    </div>
  );
}

export function LocationDiagram({
  sunny,
  sea,
  nessebar,
  hint,
}: {
  sunny: string;
  sea: string;
  nessebar: string;
  hint: string;
}) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-surface p-5 shadow-card">
      <div className="relative h-56 overflow-hidden rounded-[14px] bg-gradient-to-b from-pool to-sea/40">
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-sea/70" />
        <div className="absolute bottom-[42%] left-[18%] rounded-full bg-warm px-3 py-1 text-xs font-medium text-white">
          {sunny}
        </div>
        <div className="absolute bottom-[18%] right-[22%] text-xs font-medium text-white/90">{sea}</div>
        <div className="absolute left-[8%] top-[18%] rounded-full bg-surface px-3 py-1 text-xs text-foreground">
          {nessebar}
        </div>
        <div className="absolute bottom-[46%] left-[38%] h-2 w-2 rounded-full bg-accent" />
      </div>
      <p className="mt-3 text-xs text-muted">{hint}</p>
    </div>
  );
}
