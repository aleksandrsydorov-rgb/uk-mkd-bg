/**
 * Facts confirmed for publication in this task.
 * Phone, email, a separate place of business and VAT status are intentionally absent.
 */
export const OPERATOR_FACTS = {
  complexBg: 'Амадеус XI',
  complexEn: 'Amadeus XI',
  operatorName: '„АКВИТЕНС“ ООД',
  eik: '203078547',
  manager: 'Татяна Черенкова',
  registeredAddress:
    'гр. Несебър, п.к. 8230, к.к. „Сл. Бряг“, к-с „Амадеус XI“, вх. Б, ет. 5, ап. 34Б',
  certificateNumber: '02-01-549',
  certificateIssuedOn: '10.08.2026',
  certificateValidUntil: '10.08.2031',
  apartmentCount: 116,
  registries: [
    {
      id: 'commercial',
      href: 'https://portal.registryagency.bg/',
    },
    {
      id: 'mrrb',
      href: 'https://www.mrrb.bg/',
    },
  ],
  missingForPublication: ['phone', 'email', 'activityAddress', 'vatStatus'] as const,
} as const;
