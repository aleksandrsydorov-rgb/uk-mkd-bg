'use client';

import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* ─── Фоновые декорации ─── */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] bg-emerald-500/[0.04] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-cyan-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-teal-500/[0.02] rounded-full blur-[150px]" />
      </div>

      {/* ═══════════════════ ХЕДЕР ═══════════════════ */}
      <header className="relative z-30 border-b border-white/5 bg-[#0a0a0f]/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          {/* Логотип */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20 transition-shadow group-hover:shadow-emerald-500/30">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <span className="text-lg font-bold tracking-tight">
              МКД <span className="text-emerald-400">Болгария</span>
            </span>
          </Link>

          {/* Навигация */}
          <nav className="hidden items-center gap-1 md:flex">
            {[
              { label: 'Возможности', href: '#features' },
              { label: 'Как это работает', href: '#how' },
              { label: 'Контакты', href: '#footer' },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="rounded-lg px-4 py-2 text-sm text-white/50 transition hover:bg-white/5 hover:text-white/80"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Кнопки */}
          <div className="flex items-center gap-2">
            <Link
              href="/account"
              className="hidden rounded-xl bg-white/5 px-4 py-2 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80 sm:block"
            >
              Личный кабинет
            </Link>
            <Link
              href="/account"
              className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:shadow-emerald-500/30 active:scale-[0.98]"
            >
              Войти
            </Link>
          </div>
        </div>
      </header>

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-24 text-center md:py-36">
        {/* Декоративные линии */}
        <div className="absolute left-1/2 top-20 -translate-x-1/2 w-px h-32 bg-gradient-to-b from-transparent via-emerald-500/30 to-transparent" />

        <div className="mx-auto max-w-4xl">
          {/* Бейдж */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Прозрачное управление вашим домом
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-7xl">
            Контролируйте{' '}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
              управляющую компанию
            </span>
            <br className="hidden sm:block" />
            в реальном времени
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/40 sm:text-lg">
            Каждый рубль — на виду. Отчётность по расходам, задолженностям, работам
            и счетчикам. Без скрытых статей, без сюрпризов — только прозрачные цифры
            для собственников квартир в Болгарии.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/account"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-7 py-3.5 text-sm font-semibold text-white shadow-xl shadow-emerald-500/25 transition-all hover:shadow-emerald-500/35 active:scale-[0.98]"
            >
              Открыть личный кабинет
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 transition-transform group-hover:translate-x-0.5">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-7 py-3.5 text-sm font-medium text-white/50 transition-all hover:bg-white/[0.06] hover:text-white/70 hover:border-white/15"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 16 16 12 12 8" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
              Как это работает
            </a>
          </div>
        </div>

        {/* Статистика внизу hero */}
        <div className="mx-auto mt-20 grid max-w-2xl grid-cols-3 gap-px rounded-2xl border border-white/5 bg-white/5 overflow-hidden">
          {[
            { value: '100%', label: 'Прозрачность' },
            { value: '24/7', label: 'Доступ' },
            { value: '0', label: 'Скрытых комиссий' },
          ].map((stat, i) => (
            <div key={i} className="bg-[#0a0a0f]/80 px-6 py-5 text-center backdrop-blur-sm">
              <div className="text-2xl font-bold text-white sm:text-3xl">{stat.value}</div>
              <div className="mt-1 text-xs text-white/30 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════ ВОЗМОЖНОСТИ ═══════════════════ */}
      <section id="features" className="relative z-10 border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-24">
          {/* Заголовок */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/30 mb-6">
              <div className="h-1 w-1 rounded-full bg-emerald-400" />
              Функционал
            </div>
            <h2 className="text-3xl font-bold sm:text-4xl">
              Всё, что нужно для{' '}
              <span className="text-emerald-400">прозрачного управления</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/35">
              Каждый собственник видит полную картину: расходы, долги, показания счётчиков и статус заявок
            </p>
          </div>

          {/* Карточки */}
          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {/* 1 — Прозрачная отчётность */}
            <div className="group relative rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent p-7 transition-all duration-300 hover:border-emerald-500/20 hover:shadow-xl hover:shadow-emerald-500/[0.03]">
              {/* Акцентная полоска */}
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/15">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white/90 group-hover:text-white transition-colors">
                Прозрачная отчётность УК
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-white/35">
                Каждый расход — с документами. Каждый платёж — с проводкой. Полная
                картина того, куда уходят ваши средства: от eléctrica до уборки территории.
              </p>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {['Расходы', 'Доходы', 'Сметы', 'Акты'].map((tag) => (
                  <span key={tag} className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/25">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* 2 — Заявки на ремонт */}
            <div className="group relative rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent p-7 transition-all duration-300 hover:border-cyan-500/20 hover:shadow-xl hover:shadow-cyan-500/[0.03]">
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 transition-colors group-hover:bg-cyan-500/15">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white/90 group-hover:text-white transition-colors">
                Заявки и ремонты
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-white/35">
                Подавайте заявки онлайн, прикрепляйте фото. Отслеживайте статус
                от «Новая» до «Выполнена» — прозрачно и без звонков.
              </p>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {['Фото', 'Категории', 'Приоритет', 'История'].map((tag) => (
                  <span key={tag} className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/25">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* 3 — Задолженности и счётчики */}
            <div className="group relative rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent p-7 transition-all duration-300 hover:border-amber-500/20 hover:shadow-xl hover:shadow-amber-500/[0.03]">
              <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 transition-colors group-hover:bg-amber-500/15">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white/90 group-hover:text-white transition-colors">
                Финансы и счётчики
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-white/35">
                Задолженности, переплаты, расчёт коммунальных услуг по тарифам.
                Передача показаний счётчиков в пару кликов.
              </p>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {['Сальдо', 'Тарифы', 'Счётчики', 'История'].map((tag) => (
                  <span key={tag} className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/25">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ КАК ЭТО РАБОТАЕТ ═══════════════════ */}
      <section id="how" className="relative z-10 border-t border-white/5 bg-white/[0.01]">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/30 mb-6">
              <div className="h-1 w-1 rounded-full bg-cyan-400" />
              Процесс
            </div>
            <h2 className="text-3xl font-bold sm:text-4xl">Три шага к прозрачности</h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-white/35">
              Всего три простых шага — и вы видите всё, что происходит с вашим домом
            </p>
          </div>

          <div className="relative mt-16 grid gap-8 md:grid-cols-3">
            {/* Соединительная линия (десктоп) */}
            <div className="absolute top-12 left-[20%] right-[20%] hidden h-px md:block">
              <div className="h-full bg-gradient-to-r from-emerald-500/30 via-cyan-500/30 to-amber-500/30" />
            </div>

            {[
              {
                step: '01',
                title: 'Войдите',
                desc: 'Войдите в личный кабинет по email — доступ к вашей квартире и всем данным.',
                color: 'emerald',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
                    <polyline points="10 17 15 12 10 7" />
                    <line x1="15" y1="12" x2="3" y2="12" />
                  </svg>
                ),
              },
              {
                step: '02',
                title: 'Просмотрите',
                desc: 'Посмотрите задолженности, расходы УК, показания счётчиков и статус заявок.',
                color: 'cyan',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ),
              },
              {
                step: '03',
                title: 'Действуйте',
                desc: 'Передавайте показания, подавайте заявки, контролируйте каждую строку расходов.',
                color: 'amber',
                icon: (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                ),
              },
            ].map((item, i) => (
              <div key={i} className="relative text-center">
                {/* Номер */}
                <div className="relative mx-auto mb-6">
                  <div
                    className={`mx-auto flex h-24 w-24 items-center justify-center rounded-2xl border border-white/5 bg-gradient-to-br from-white/[0.04] to-transparent transition-all duration-300 hover:scale-105 hover:border-${item.color}-500/20`}
                  >
                    <div className={`text-${item.color}-400`}>{item.icon}</div>
                  </div>
                  <div className={`absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-${item.color}-500 text-[10px] font-bold text-white shadow-lg`}>
                    {item.step}
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-white/90">{item.title}</h3>
                <p className="mt-2 mx-auto max-w-xs text-sm leading-relaxed text-white/35">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ CTA ═══════════════════ */}
      <section className="relative z-10 border-t border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-cyan-500/10 p-12 text-center md:p-16">
            {/* Декор */}
            <div className="absolute top-0 left-1/4 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px]" />
            <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px]" />

            <div className="relative z-10">
              <h2 className="text-3xl font-bold sm:text-4xl">
                Готовы видеть{' '}
                <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                  реальную картину
                </span>
                ?
              </h2>
              <p className="mx-auto mt-4 max-w-lg text-sm text-white/40">
                Войдите в личный кабинет и убедитесь: прозрачная отчётность — это просто.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <Link
                  href="/account"
                  className="group inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-semibold text-gray-900 shadow-xl shadow-white/10 transition-all hover:shadow-white/15 active:scale-[0.98]"
                >
                  Войти в кабинет
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 transition-transform group-hover:translate-x-0.5">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ ФУТЕР ═══════════════════ */}
      <footer id="footer" className="relative z-10 border-t border-white/5 bg-[#0a0a0f]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-12 md:grid-cols-4">
            {/* Логотип и описание */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <span className="text-lg font-bold">
                  МКД <span className="text-emerald-400">Болгария</span>
                </span>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-white/30">
                Платформа прозрачного управления многоквартирными домами в Болгарии.
                Каждый собственник имеет право видеть, как управляются его деньги.
              </p>
            </div>

            {/* Ссылки */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/20 mb-4">Навигация</h4>
              <ul className="space-y-2.5">
                {[
                  { label: 'Личный кабинет', href: '/account' },
                  { label: 'Возможности', href: '#features' },
                  { label: 'Как это работает', href: '#how' },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-white/30 transition hover:text-white/60">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/20 mb-4">Контакты</h4>
              <ul className="space-y-2.5">
                <li className="text-sm text-white/30">Sofia, Bulgaria</li>
                <li>
                  <a href="mailto:info@mkdbulgaria.com" className="text-sm text-emerald-400/60 transition hover:text-emerald-400">
                    info@mkdbulgaria.com
                  </a>
                </li>
                <li>
                  <a href="tel:+359888123456" className="text-sm text-white/30 transition hover:text-white/60">
                    +359 888 123 456
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Нижняя полоска */}
          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/5 pt-8 sm:flex-row">
            <p className="text-xs text-white/20">
              © {new Date().getFullYear()} МКД Болгария. Все права защищены.
            </p>
            <div className="flex items-center gap-1 text-xs text-white/15">
              Сделано с
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3 text-red-500/50">
                <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
              </svg>
              для комфорта собственников.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}