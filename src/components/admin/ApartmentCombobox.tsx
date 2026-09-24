'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';
import { adminFieldClass } from '@/components/admin/AdminUi';

export type ApartmentOption = {
  id: number;
  apartment_number: string | number | null;
  owner_name?: string | null;
  owner_email?: string | null;
};

function apartmentNumber(value: string | number | null | undefined) {
  return String(value ?? '').trim();
}

export function apartmentOptionLabel(property: ApartmentOption) {
  const number = apartmentNumber(property.apartment_number);
  const owner = (property.owner_name ?? '').trim();
  const title = number ? `№${number}` : '—';
  return owner ? `${title} — ${owner}` : title;
}

export function ApartmentCombobox({
  properties,
  value,
  onChange,
  disabled = false,
  required = false,
  className = '',
}: {
  properties: ApartmentOption[];
  value: number | '';
  onChange: (id: number | '') => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = properties.find((property) => property.id === value) ?? null;
  const selectedLabel = selected ? apartmentOptionLabel(selected) : '';

  const filtered = useMemo(() => {
    const sorted = [...properties].sort((a, b) =>
      apartmentNumber(a.apartment_number).localeCompare(apartmentNumber(b.apartment_number), undefined, {
        numeric: true,
      }),
    );
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((property) => {
      const number = apartmentNumber(property.apartment_number).toLowerCase();
      const owner = (property.owner_name ?? '').toLowerCase();
      const email = (property.owner_email ?? '').toLowerCase();
      return number.includes(q) || owner.includes(q) || (email.length > 0 && email.includes(q));
    });
  }, [properties, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function choose(id: number) {
    onChange(id);
    setQuery('');
    setOpen(false);
  }

  function clear() {
    onChange('');
    setQuery('');
    setOpen(false);
  }

  const shown = open ? query : selectedLabel;
  const activeId = open && filtered[active] ? `${listId}-${filtered[active].id}` : undefined;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {required ? (
        <input tabIndex={-1} className="sr-only" value={value === '' ? '' : String(value)} required readOnly aria-hidden />
      ) : null}
      <div className="flex gap-2">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          disabled={disabled}
          className={adminFieldClass}
          placeholder={t('admin.aptSearchPlaceholder')}
          value={shown}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (disabled) return;
            setQuery('');
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.min(filtered.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && filtered[active]) {
              event.preventDefault();
              choose(filtered[active].id);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setQuery('');
              setOpen(false);
            }
          }}
        />
        {value !== '' && !disabled ? (
          <button type="button" className="shrink-0 rounded-lg border border-border px-3 text-sm text-secondary hover:bg-hover" onClick={clear}>
            {t('admin.aptClear')}
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-card"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">{t('admin.aptSearchEmpty')}</li>
          ) : (
            filtered.map((property, index) => {
              const label = apartmentOptionLabel(property);
              const isActive = index === active;
              const isSelected = property.id === value;
              return (
                <li
                  key={property.id}
                  id={`${listId}-${property.id}`}
                  role="option"
                  aria-selected={isSelected}
                  className={`cursor-pointer px-3 py-2 text-sm ${isActive ? 'bg-hover text-foreground' : 'text-secondary'}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(property.id);
                  }}
                >
                  {label}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
