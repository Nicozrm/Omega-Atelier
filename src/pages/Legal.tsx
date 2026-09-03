/**
 * Legal / mandatory pages (Pflichtseiten) for OMEGA Atelier:
 * Impressum, Datenschutzerklärung, AGB.
 *
 * Content is adapted from the operator's source documents — rebranded to
 * OMEGA Atelier, dated 2026, TMG references updated to the DDG (which replaced
 * the TMG in 2024), and the hosting / data-processing sections aligned with the
 * app's real stack (GitHub Pages hosting, Supabase auth + database, Google
 * sign-in, Google Fonts). Styled in the app's own design system rather than the
 * source's standalone theme, and mounted as public routes.
 */
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/** Operator / responsible entity — the legally required Anbieterkennzeichnung. */
const OPERATOR = {
  brand: 'OMEGA Atelier',
  name: 'Nico Zimmermann',
  zip: '48565 Steinfurt',
  country: 'Deutschland',
  email: 'n.zimmermann711@outlook.de',
  phone: '+49 152 92612795',
  vat: 'DE 128 456 422',
}
const STAND = 'Stand: Juli 2026'
const UPDATED = 'Letzte Aktualisierung: 08.07.2026'

// ── Presentational helpers ─────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg text-[color:var(--accent)] border-b border-[color:var(--border)] pb-2">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-[color:var(--muted)]">{children}</div>
    </section>
  )
}
function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="font-medium text-[color:var(--fg)] pt-1">{children}</h3>
}
function UL({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-4">
      {items.map((it, i) => (
        <li key={i} className="relative pl-3 before:absolute before:left-0 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-[color:var(--accent)]/60">{it}</li>
      ))}
    </ul>
  )
}
function ContactBox() {
  return (
    <div className="surface p-4 space-y-1 text-sm">
      <p className="font-medium text-[color:var(--fg)]">{OPERATOR.brand}</p>
      <p>{OPERATOR.name}</p>
      <p>{OPERATOR.zip}</p>
      <p>{OPERATOR.country}</p>
    </div>
  )
}
function A({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className="text-[color:var(--accent)] hover:underline" target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{children}</a>
}

function LegalLayout({ title, meta, children, self }: {
  title: string; meta: string; children: React.ReactNode; self: 'impressum' | 'datenschutz' | 'agb'
}) {
  const links: Array<[string, string, 'impressum' | 'datenschutz' | 'agb']> = [
    ['/impressum', 'Impressum', 'impressum'],
    ['/datenschutz', 'Datenschutz', 'datenschutz'],
    ['/agb', 'AGB', 'agb'],
  ]
  return (
    <div className="omega-noise omega-scroll h-screen overflow-y-auto">
      <header className="flex h-14 items-center gap-3 border-b border-[color:var(--border)] bg-[color:var(--bg)] px-4 safe-top">
        <Link to="/" className="btn btn-ghost btn-icon" aria-label="Zurück zum Start"><ArrowLeft size={16} /></Link>
        <div className="font-display text-lg">{OPERATOR.brand}</div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 space-y-8">
        <div className="space-y-1">
          <h1 className="font-display text-3xl">{title}</h1>
          <p className="text-xs text-[color:var(--muted)]">{meta}</p>
        </div>
        {children}

        <footer className="border-t border-[color:var(--border)] pt-6 text-center text-xs text-[color:var(--muted)] space-x-3">
          <span>© 2026 {OPERATOR.brand}</span>
          {links.filter(([, , key]) => key !== self).map(([to, label]) => (
            <Link key={to} to={to} className="text-[color:var(--accent)] hover:underline">{label}</Link>
          ))}
        </footer>
      </main>
    </div>
  )
}

// ── Impressum (§ 5 DDG) ────────────────────────────────────────────────
export function ImpressumPage() {
  return (
    <LegalLayout title="Impressum" meta={`Angaben gemäß § 5 DDG | ${STAND}`} self="impressum">
      <Section title="Anbieter">
        <ContactBox />
      </Section>
      <Section title="Kontakt">
        <p><strong className="text-[color:var(--fg)]">E-Mail:</strong> <A href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</A></p>
        <p><strong className="text-[color:var(--fg)]">Telefon:</strong> <A href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`}>{OPERATOR.phone}</A></p>
      </Section>
      <Section title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <p>{OPERATOR.name}</p>
        <p>{OPERATOR.zip}</p>
      </Section>
      <Section title="Umsatzsteuer-Identifikationsnummer">
        <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:</p>
        <p className="text-[color:var(--fg)] font-medium">{OPERATOR.vat}</p>
      </Section>
      <Section title="Streitschlichtung">
        <p>Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: <A href="https://ec.europa.eu/consumers/odr/">https://ec.europa.eu/consumers/odr/</A></p>
        <p>Unsere E-Mail-Adresse finden Sie oben im Impressum.</p>
        <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      </Section>
      <Section title="Haftung für Inhalte">
        <p>Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.</p>
        <p>Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.</p>
      </Section>
      <Section title="Haftung für Links">
        <p>Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.</p>
        <p>Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der Verlinkung nicht erkennbar. Eine permanente inhaltliche Kontrolle der verlinkten Seiten ist jedoch ohne konkrete Anhaltspunkte einer Rechtsverletzung nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Links umgehend entfernen.</p>
      </Section>
      <Section title="Urheberrecht">
        <p>Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.</p>
        <p>Downloads und Kopien dieser Seite sind nur für den privaten, nicht kommerziellen Gebrauch gestattet. Soweit die Inhalte auf dieser Seite nicht vom Betreiber erstellt wurden, werden die Urheberrechte Dritter beachtet. Insbesondere werden Inhalte Dritter als solche gekennzeichnet. Sollten Sie trotzdem auf eine Urheberrechtsverletzung aufmerksam werden, bitten wir um einen entsprechenden Hinweis. Bei Bekanntwerden von Rechtsverletzungen werden wir derartige Inhalte umgehend entfernen.</p>
      </Section>
    </LegalLayout>
  )
}

// ── Datenschutzerklärung ───────────────────────────────────────────────
export function DatenschutzPage() {
  return (
    <LegalLayout title="Datenschutzerklärung" meta={`${STAND} | ${UPDATED}`} self="datenschutz">
      <Section title="1. Verantwortlicher">
        <div className="surface p-4 space-y-1 text-sm">
          <p className="font-medium text-[color:var(--fg)]">{OPERATOR.brand}</p>
          <p>{OPERATOR.name}</p>
          <p>{OPERATOR.zip}</p>
          <p>E-Mail: <A href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</A></p>
          <p>Telefon: {OPERATOR.phone}</p>
        </div>
      </Section>
      <Section title="2. Übersicht der Verarbeitungen">
        <p>Wir verarbeiten personenbezogene Daten nur, wenn dies für die Bereitstellung unserer Anwendung und Dienstleistungen erforderlich ist. Die nachfolgende Übersicht fasst die Arten der verarbeiteten Daten und die Zwecke ihrer Verarbeitung zusammen:</p>
        <Sub>Arten der verarbeiteten Daten</Sub>
        <UL items={[
          'Bestandsdaten (Name, Adresse)',
          'Kontaktdaten (E-Mail, Telefonnummer)',
          'Kontodaten (E-Mail-Adresse, Anmeldeinformationen)',
          'Inhaltsdaten (Grundrisse, Geräte- und Szenenkonfigurationen, Projektbeschreibungen)',
          'Nutzungsdaten (besuchte Seiten, Zugriffszeit)',
          'Meta-/Kommunikationsdaten (IP-Adressen, Geräteinformationen)',
        ]} />
        <Sub>Kategorien betroffener Personen</Sub>
        <UL items={[
          'Nutzer der Anwendung (registriert und lokal)',
          'Interessenten und Geschäftskunden',
          'Besucher der Website',
        ]} />
      </Section>
      <Section title="3. Rechtsgrundlagen">
        <p>Wir verarbeiten Ihre Daten auf Grundlage folgender Rechtsgrundlagen:</p>
        <UL items={[
          'Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) – Sie haben Ihre Einwilligung für bestimmte Verarbeitungszwecke erteilt.',
          'Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) – Die Verarbeitung ist zur Erfüllung eines Vertrags bzw. zur Bereitstellung der Anwendung erforderlich.',
          'Rechtliche Verpflichtung (Art. 6 Abs. 1 lit. c DSGVO) – Die Verarbeitung ist zur Erfüllung einer rechtlichen Verpflichtung erforderlich.',
          'Berechtigte Interessen (Art. 6 Abs. 1 lit. f DSGVO) – Die Verarbeitung ist zur Wahrung unserer berechtigten Interessen erforderlich.',
        ]} />
      </Section>
      <Section title="4. Nutzerkonto & Cloud-Speicherung">
        <p>Für die Nutzung der Cloud-Funktionen (Speichern und Synchronisieren Ihrer Grundriss-Projekte) können Sie ein Nutzerkonto anlegen. Die Anmeldung ist per E-Mail/Passwort sowie optional über Google (OAuth) möglich.</p>
        <Sub>Verarbeitete Daten</Sub>
        <UL items={[
          'E-Mail-Adresse und Authentifizierungsdaten',
          'Ihre gespeicherten Projekte (Grundrisse, Geräte, Szenen)',
          'Bei OAuth: die von Google bereitgestellte Kennung und E-Mail-Adresse',
        ]} />
        <Sub>Rechtsgrundlage</Sub>
        <p>Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der vertraglich vereinbarten Funktionen).</p>
        <Sub>Hinweis</Sub>
        <p>Die Anwendung ist auch ohne Konto lokal nutzbar. In diesem Fall werden Ihre Projekte ausschließlich lokal in Ihrem Browser (localStorage) gespeichert und nicht an uns übertragen.</p>
      </Section>
      <Section title="5. Hosting & Server">
        <p>Unsere Anwendung wird bei folgenden Anbietern betrieben:</p>
        <UL items={[
          <><strong className="text-[color:var(--fg)]">GitHub, Inc.</strong> – Hosting und Auslieferung der Web-Anwendung (GitHub Pages)</>,
          <><strong className="text-[color:var(--fg)]">Supabase</strong> – Authentifizierung und Datenbank (Speicherung der Nutzerkonten und Projekte)</>,
          <><strong className="text-[color:var(--fg)]">Google Fonts</strong> – Schriftarten (extern geladen; IP-Adresse wird an Google-Server übertragen)</>,
        ]} />
        <p>Bei jedem Zugriff werden automatisch Server-Logfiles erstellt, die IP-Adresse, Zeitstempel, aufgerufene Seite und Browser-Informationen enthalten. Diese Daten werden ausschließlich zur Sicherstellung des technischen Betriebs und zur Abwehr von Angriffen verwendet.</p>
        <Sub>Rechtsgrundlage</Sub>
        <p>Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an sicherem Betrieb).</p>
      </Section>
      <Section title="6. Cookies & lokale Speicherung">
        <p>Unsere Anwendung verwendet derzeit keine Tracking-Cookies und keine Analyse-Tools wie Google Analytics.</p>
        <Sub>Technisch notwendige Speicherung</Sub>
        <p>Es werden ausschließlich technisch notwendige Cookies bzw. lokale Speichermechanismen (Session-/Auth-Token, localStorage für Ihre lokalen Projekte und Einstellungen) verwendet, die für den Betrieb der Anwendung erforderlich sind. Diese erfordern keine Einwilligung.</p>
      </Section>
      <Section title="7. Ihre Rechte">
        <p>Sie haben folgende Rechte bezüglich Ihrer personenbezogenen Daten:</p>
        <UL items={[
          'Auskunftsrecht (Art. 15 DSGVO)',
          'Berichtigungsrecht (Art. 16 DSGVO)',
          'Löschungsrecht (Art. 17 DSGVO)',
          'Einschränkung der Verarbeitung (Art. 18 DSGVO)',
          'Datenübertragbarkeit (Art. 20 DSGVO)',
          'Widerspruchsrecht (Art. 21 DSGVO)',
          'Widerruf der Einwilligung (Art. 7 Abs. 3 DSGVO)',
          'Beschwerderecht bei einer Aufsichtsbehörde (Art. 77 DSGVO)',
        ]} />
      </Section>
      <Section title="8. Löschung Ihres Kontos">
        <p>Sie können die Löschung Ihres Kontos und der zugehörigen Daten jederzeit per E-Mail an <A href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</A> verlangen. Wir löschen Ihre Daten, sofern keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p>
      </Section>
      <Section title="9. Änderungen dieser Datenschutzerklärung">
        <p>Wir behalten uns vor, diese Datenschutzerklärung anzupassen, damit sie stets den aktuellen rechtlichen Anforderungen entspricht oder um Änderungen unserer Leistungen umzusetzen. Für Ihren erneuten Besuch gilt dann die neue Datenschutzerklärung.</p>
      </Section>
    </LegalLayout>
  )
}

// ── AGB ────────────────────────────────────────────────────────────────
export function AGBPage() {
  return (
    <LegalLayout title="Allgemeine Geschäftsbedingungen" meta={STAND} self="agb">
      <Section title="§ 1 Geltungsbereich">
        <p>(1) Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen {OPERATOR.brand} ({OPERATOR.name}), {OPERATOR.zip} (nachfolgend „Anbieter") und dem jeweiligen Nutzer bzw. Auftraggeber.</p>
        <p>(2) Abweichende Bedingungen des Auftraggebers werden nicht anerkannt, es sei denn, der Anbieter stimmt ihrer Geltung ausdrücklich schriftlich zu.</p>
        <p>(3) Diese AGB gelten auch für alle zukünftigen Geschäftsbeziehungen, selbst wenn sie nicht nochmals ausdrücklich vereinbart werden.</p>
      </Section>
      <Section title="§ 2 Vertragsgegenstand">
        <p>(1) Der Anbieter stellt mit OMEGA Atelier eine Softwareanwendung (Web-App) zur Planung von Smart-Home-Installationen bereit. Der Funktionsumfang umfasst insbesondere einen interaktiven 2D-Grundrisseditor, eine 3D-Visualisierung sowie die Verwaltung von Geräten, Ökosystemen und Szenen.</p>
        <p>(2) Darüber hinaus kann der Anbieter projektbezogene Dienstleistungen im Bereich Planung, Konfiguration und Beratung erbringen.</p>
        <p>(3) Der genaue Leistungsumfang ergibt sich aus dem jeweiligen Angebot, dem gewählten Tarif bzw. der Leistungsbeschreibung.</p>
      </Section>
      <Section title="§ 3 Angebot und Vertragsschluss">
        <p>(1) Angebote des Anbieters sind freibleibend und unverbindlich, sofern nicht ausdrücklich anders angegeben.</p>
        <p>(2) Der Vertrag kommt durch Registrierung bzw. Nutzung der Anwendung, durch schriftliche Auftragsbestätigung des Anbieters oder durch Beginn der Leistungserbringung zustande.</p>
        <p>(3) Änderungen oder Ergänzungen individueller Verträge bedürfen der Schriftform.</p>
      </Section>
      <Section title="§ 4 Vergütung und Zahlungsbedingungen">
        <p>(1) Die Vergütung richtet sich nach dem jeweiligen Angebot bzw. dem gewählten Tarif. Alle Preise verstehen sich zuzüglich der gesetzlichen Mehrwertsteuer.</p>
        <p>(2) Sofern projektbezogene Leistungen vereinbart werden, erfolgt die Zahlung — soweit nicht anders vereinbart — in Meilensteinen:</p>
        <UL items={['40 % bei Auftragserteilung', '30 % nach Abnahme des Entwurfs', '30 % bei Projektabschluss']} />
        <p>(3) Rechnungen sind innerhalb von 14 Tagen nach Rechnungsdatum ohne Abzug zahlbar.</p>
        <p>(4) Bei Zahlungsverzug ist der Anbieter berechtigt, Verzugszinsen in gesetzlicher Höhe zu berechnen.</p>
        <div className="surface p-4 border-l-2 border-[color:var(--accent)]"><p className="text-sm"><strong className="text-[color:var(--fg)]">Hinweis:</strong> Abweichende Zahlungsmodalitäten können im individuellen Angebot vereinbart werden.</p></div>
      </Section>
      <Section title="§ 5 Mitwirkungspflichten des Auftraggebers">
        <p>(1) Der Auftraggeber stellt dem Anbieter alle für die Durchführung erforderlichen Unterlagen, Informationen und Zugänge rechtzeitig zur Verfügung.</p>
        <p>(2) Der Auftraggeber benennt bei projektbezogenen Leistungen einen bevollmächtigten Ansprechpartner.</p>
        <p>(3) Verzögerungen durch unzureichende Mitwirkung können zu Terminverschiebungen und Mehrkosten führen.</p>
      </Section>
      <Section title="§ 6 Leistungserbringung und Abnahme">
        <p>(1) Der Anbieter erbringt die vereinbarten Leistungen nach bestem Wissen und Gewissen und unter Einhaltung der anerkannten Regeln der Technik.</p>
        <p>(2) Fertige projektbezogene Leistungen werden dem Auftraggeber zur Abnahme vorgelegt. Die Abnahme gilt als erteilt, wenn der Auftraggeber nicht innerhalb von 14 Tagen nach Vorlage schriftlich Mängel rügt.</p>
        <p>(3) Geringfügige Abweichungen, die die Funktionalität nicht beeinträchtigen, berechtigen nicht zur Abnahmeverweigerung.</p>
      </Section>
      <Section title="§ 7 Nutzungsrechte und Eigentum">
        <p>(1) Der Anbieter räumt dem Nutzer für die Dauer des Vertrags ein einfaches, nicht übertragbares Recht zur Nutzung der Anwendung im vereinbarten Umfang ein.</p>
        <p>(2) An projektbezogen erstellten Werken erhält der Auftraggeber nach vollständiger Bezahlung die im Angebot definierten Nutzungsrechte. Standardmäßig umfasst dies:</p>
        <UL items={[
          'das einfache, zeitlich unbefristete Nutzungsrecht für den vereinbarten Zweck',
          'das Recht zur Veröffentlichung und öffentlichen Zugänglichmachung',
          'das Recht zur Bearbeitung durch den Auftraggeber oder Dritte',
        ]} />
        <p>(3) Ausgenommen sind:</p>
        <UL items={[
          'Quellcode proprietärer Tools und Frameworks des Anbieters',
          'Drittkomponenten (z. B. Stock-Medien, Open-Source-Software), für die separate Lizenzbedingungen gelten',
          'Entwürfe und Konzepte, die nicht zur Umsetzung beauftragt wurden',
        ]} />
        <p>(4) Open-Source-Komponenten unterliegen ihren jeweiligen Lizenzbedingungen (z. B. MIT, GPL).</p>
        <p>(5) Der Anbieter behält sich das Recht vor, erstellte Arbeiten in anonymisierter Form als Referenz zu nutzen, sofern keine entgegenstehende Vereinbarung besteht.</p>
      </Section>
      <Section title="§ 8 Gewährleistung und Haftung">
        <p>(1) Der Anbieter gewährleistet, dass die erbrachten Leistungen den vereinbarten Anforderungen entsprechen.</p>
        <p>(2) Mängel sind unverzüglich nach Entdeckung schriftlich zu rügen. Der Anbieter hat das Recht zur Nachbesserung.</p>
        <p>(3) Die Gewährleistungsfrist für projektbezogene Leistungen beträgt 12 Monate ab Abnahme.</p>
        <p>(4) Die Haftung für leichte Fahrlässigkeit wird ausgeschlossen, soweit keine wesentlichen Vertragspflichten verletzt werden. Die Haftung ist auf den vorhersehbaren, vertragstypischen Schaden begrenzt.</p>
        <p>(5) Die vorstehenden Haftungsbeschränkungen gelten nicht bei Vorsatz, grober Fahrlässigkeit, Verletzung von Leben, Körper oder Gesundheit.</p>
      </Section>
      <Section title="§ 9 Vertraulichkeit">
        <p>(1) Beide Parteien verpflichten sich, alle im Rahmen der Zusammenarbeit erhaltenen vertraulichen Informationen geheim zu halten.</p>
        <p>(2) Diese Verpflichtung gilt auch nach Beendigung des Vertragsverhältnisses.</p>
      </Section>
      <Section title="§ 10 Kündigung">
        <p>(1) Der Nutzer kann den Vertrag bzw. sein Konto jederzeit kündigen. Bei projektbezogenen Leistungen sind alle bis zum Kündigungszeitpunkt erbrachten Leistungen zu vergüten.</p>
        <p>(2) Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt.</p>
      </Section>
      <Section title="§ 11 Schlussbestimmungen">
        <p>(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts.</p>
        <p>(2) Gerichtsstand ist, soweit gesetzlich zulässig, der Sitz des Anbieters.</p>
        <p>(3) Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.</p>
      </Section>
    </LegalLayout>
  )
}
