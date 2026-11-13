// Monthly PDF report layout (Phase 5), with @react-pdf/renderer. Only lays out
// a MonthlyReport (built by monthly.ts); no data access here. Uses the PDF
// standard Helvetica font, so no font files are needed anywhere. Rendered in
// the browser on demand (the library is loaded only when you press Download).

import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import { fmtAUD, fmtDate, monthLabel } from '../format'
import type { MonthlyReport } from './monthly'

const C = { ink: '#111827', muted: '#6b7280', faint: '#9ca3af', line: '#e5e7eb', accent: '#4f46e5', good: '#15803d', bad: '#b91c1c', pink: '#db2777' }

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 9.5, color: C.ink, lineHeight: 1.35 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  logo: { width: 34, height: 34, marginRight: 10 },
  brand: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  sub: { fontSize: 9, color: C.muted },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 5, color: C.accent },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: C.line },
  label: { color: C.muted, flexShrink: 1, paddingRight: 8 },
  num: { fontFamily: 'Helvetica', textAlign: 'right' },
  bold: { fontFamily: 'Helvetica-Bold' },
  stats: { flexDirection: 'row', marginBottom: 4 },
  stat: { flex: 1, paddingRight: 8 },
  statLabel: { fontSize: 8, color: C.muted },
  statValue: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
  note: { fontSize: 8, color: C.muted, marginTop: 3 },
  small: { fontSize: 8.5 },
  insight: { marginBottom: 6 },
  bar: { height: 6, backgroundColor: C.line, borderRadius: 3, marginTop: 4, marginBottom: 4 },
  barFill: { height: 6, backgroundColor: C.accent, borderRadius: 3 },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.faint },
  cols: { flexDirection: 'row' },
  col: { flex: 1, paddingRight: 10 },
})

const mon = (mk: string) => monthLabel(mk, { month: 'short', year: 'numeric' })
const signed = (c: number) => fmtAUD(c, { signed: true })

function Line({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <View style={s.rowLine} wrap={false}>
      <Text style={s.label}>{label}</Text>
      <Text style={[s.num, bold ? s.bold : {}, color ? { color } : {}]}>{value}</Text>
    </View>
  )
}

export function ReportDocument({ r, logoSrc }: { r: MonthlyReport; logoSrc?: string | null }) {
  const title = `${monthLabel(r.month)} report`
  return (
    <Document title={`Bun & Chump · ${title}`} author="Bun & Chump" subject="Monthly money report" creator="Bun & Chump">
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image has no alt; the brand name sits beside it */}
          {logoSrc ? <Image src={logoSrc} style={s.logo} /> : null}
          <View>
            <Text style={s.brand}>Bun &amp; Chump</Text>
            <Text style={s.sub}>{title}{r.complete ? '' : ' (month to date)'}</Text>
          </View>
        </View>

        {/* Net worth */}
        <Text style={s.h2}>Net worth</Text>
        <View style={s.stats}>
          <View style={s.stat}><Text style={s.statLabel}>End of {monthLabel(r.month, { month: 'long' })}</Text><Text style={s.statValue}>{fmtAUD(r.netWorth.endCents)}</Text></View>
          <View style={s.stat}><Text style={s.statLabel}>Change on the month</Text><Text style={[s.statValue, { color: r.netWorth.changeCents >= 0 ? C.good : C.bad }]}>{signed(r.netWorth.changeCents)}</Text></View>
          <View style={s.stat}><Text style={s.statLabel}>Start of month</Text><Text style={s.statValue}>{fmtAUD(r.netWorth.startCents)}</Text></View>
        </View>
        {r.netWorth.rows.map(x => <Line key={x.label} label={x.label} value={signed(x.cents)} />)}
        <Text style={s.note}>The three rows add up to the change exactly. Month-end balances, each account&apos;s last known balance carried forward.</Text>

        {/* Income vs spending */}
        <Text style={s.h2}>Income and spending</Text>
        <View style={s.stats}>
          <View style={s.stat}><Text style={s.statLabel}>Money in</Text><Text style={s.statValue}>{fmtAUD(r.cashflow.incomeCents)}</Text></View>
          <View style={s.stat}><Text style={s.statLabel}>Spent</Text><Text style={s.statValue}>{fmtAUD(r.cashflow.spentCents)}</Text></View>
          <View style={s.stat}><Text style={s.statLabel}>Saved</Text><Text style={[s.statValue, { color: r.cashflow.savedCents >= 0 ? C.good : C.bad }]}>{fmtAUD(r.cashflow.savedCents, { signed: r.cashflow.savedCents < 0 })}{r.cashflow.savedPct !== null ? ` (${Math.round(r.cashflow.savedPct * 100)}%)` : ''}</Text></View>
        </View>
        <Text style={s.note}>Transfers between your own accounts aren&apos;t counted; refunds are netted off spending.</Text>

        {/* Budgets */}
        <Text style={s.h2}>Budgets by category</Text>
        {r.budgets.lines.length === 0 ? <Text style={s.small}>No spending recorded this month.</Text> : (
          <View>
            {r.budgets.lines.map(l => (
              <Line key={l.id} label={l.name}
                value={l.targetCents !== null ? `${fmtAUD(l.spentCents)} of ${fmtAUD(l.targetCents)} · ${l.status === 'over' ? `${fmtAUD(-(l.diffCents ?? 0))} over` : `${fmtAUD(l.diffCents ?? 0)} under`}` : `${fmtAUD(l.spentCents)} (no budget)`}
                color={l.status === 'over' ? C.bad : l.status === 'under' ? C.good : undefined} />
            ))}
            {r.budgets.totalTargetCents > 0 && (
              <Line label={`Total on budgeted categories${r.budgets.overCount ? ` (${r.budgets.overCount} over)` : ''}`} value={`${fmtAUD(r.budgets.totalSpentOnTargetsCents)} of ${fmtAUD(r.budgets.totalTargetCents)}`} bold />
            )}
          </View>
        )}

        {/* Insights */}
        <Text style={s.h2} break={r.budgets.lines.length > 14}>Worth a look</Text>
        {r.insights.length === 0 ? <Text style={s.small}>Nothing stood out.</Text> : r.insights.map(i => (
          <View key={i.title} style={s.insight} wrap={false}>
            <Text style={s.bold}>{i.title}</Text>
            <Text style={s.small}>{i.impactLabel}{i.deposit ? ` · ${i.deposit}` : ''}</Text>
            <Text style={[s.small, { color: C.muted }]}>{i.detail}</Text>
          </View>
        ))}

        <View style={s.cols}>
          {/* Bills */}
          <View style={s.col}>
            <Text style={s.h2}>Bills and subscriptions</Text>
            <Text style={s.small}>{r.subscriptions.count} subscription{r.subscriptions.count === 1 ? '' : 's'} found, about {fmtAUD(r.subscriptions.monthlyCents)} a month.</Text>
            {r.subscriptions.items.map(x => <Line key={x.name + x.cadence} label={`${x.name} (${x.cadence})`} value={fmtAUD(x.amountCents, { full: true })} />)}
            {r.bills.length > 0 && <Text style={[s.small, s.bold, { marginTop: 5 }]}>Due in the next two weeks</Text>}
            {r.bills.map(b => <Line key={b.date + b.label} label={`${fmtDate(b.date, { day: 'numeric', month: 'short' })} · ${b.label}`} value={fmtAUD(b.cents, { full: true })} />)}
          </View>

          {/* Super cap */}
          <View style={s.col}>
            <Text style={s.h2}>Super cap headroom{r.superCap[0] ? ` · ${r.superCap[0].fy}` : ''}</Text>
            {r.superCap.length === 0 ? <Text style={s.small}>No people set up.</Text> : r.superCap.map(c => (
              <View key={c.name} style={{ marginBottom: 4 }} wrap={false}>
                <Line label={c.name} value={c.headroomCents < 0 ? `${fmtAUD(-c.headroomCents)} over the cap` : `${fmtAUD(c.headroomCents)} room left`} color={c.headroomCents < 0 ? C.bad : C.good} bold />
                <Text style={s.note}>Employer {fmtAUD(c.sgCents)} · entered {fmtAUD(c.voluntaryCents)}{c.plannedCents ? ` · salary sacrifice in the plan ${fmtAUD(c.plannedCents)}` : ''} · cap {fmtAUD(c.capCents)}</Text>
              </View>
            ))}
            {r.sacrifice.length > 0 && (
              <Text style={s.note}>Salary sacrifice: {r.sacrifice.map(x => `${x.name} ${fmtAUD(x.annualCents)}/yr`).join(', ')}{r.fhssOn ? '; FHSS on for the house.' : '.'}</Text>
            )}
          </View>
        </View>

        {/* Deposit or home loan */}
        {r.homeLoan ? (
          <View wrap={false}>
            <Text style={s.h2}>Home loan</Text>
            <View style={s.stats}>
              <View style={s.stat}><Text style={s.statLabel}>Owed</Text><Text style={s.statValue}>{fmtAUD(r.homeLoan.balanceCents)}</Text></View>
              <View style={s.stat}><Text style={s.statLabel}>Offset</Text><Text style={s.statValue}>{fmtAUD(r.homeLoan.offsetCents)}</Text></View>
              <View style={s.stat}><Text style={s.statLabel}>Paid off</Text><Text style={s.statValue}>{r.homeLoan.payoffMonth ? mon(r.homeLoan.payoffMonth) : '—'}</Text></View>
            </View>
            <Line label="Rate (effective after offset)" value={`${r.homeLoan.ratePct}% (${r.homeLoan.effectiveRatePct}%)`} />
            <Line label="Interest this month" value={fmtAUD(r.homeLoan.interestThisMonthCents)} />
            <Line label="Saved by the offset this month" value={fmtAUD(r.homeLoan.savedByOffsetThisMonthCents)} color={C.good} />
            <Line label="Repayment" value={`${fmtAUD(r.homeLoan.repaymentCents)}/mo`} />
            {r.homeLoan.payoffWithoutOffsetMonth && <Line label="Paid off without the offset" value={mon(r.homeLoan.payoffWithoutOffsetMonth)} />}
            <Text style={s.note}>{r.homeLoan.source === 'account' ? r.homeLoan.loanName : 'From the plan (no mortgage account yet)'}. Payoff assumes today&apos;s repayment and offset continue.</Text>
          </View>
        ) : r.deposit ? (
          <View wrap={false}>
            <Text style={s.h2}>House deposit</Text>
            <Text>{fmtAUD(r.deposit.currentCents)} of {fmtAUD(r.deposit.targetCents)} ({r.deposit.pct}%) for &ldquo;{r.deposit.eventName}&rdquo;</Text>
            <View style={s.bar}><View style={[s.barFill, { width: `${r.deposit.pct}%` }]} /></View>
            <Text style={s.small}>
              {r.deposit.projectedMonth === 'now' ? 'Reached.' : r.deposit.projectedMonth ? `Projected ${mon(r.deposit.projectedMonth)} (target ${mon(r.deposit.byMonth)})` : `Not reached in the projection (target ${mon(r.deposit.byMonth)})`}
              {r.deposit.monthsLate !== null && r.deposit.projectedMonth !== 'now' ? (r.deposit.monthsLate > 0 ? `, ${r.deposit.monthsLate} months behind.` : r.deposit.monthsLate < 0 ? `, ${-r.deposit.monthsLate} months early.` : ', on time.') : ''}
              {r.deposit.extraMonthlyCents ? ` +${fmtAUD(r.deposit.extraMonthlyCents)}/mo closes the gap.` : ''}
            </Text>
            {r.deposit.fhss && <Text style={s.small}>Includes about {fmtAUD(r.deposit.fhss.netCents)} FHSS release (after tax) in {mon(r.deposit.fhss.month)}.</Text>}
          </View>
        ) : null}

        {!r.complete && <Text style={s.note}>This month isn&apos;t over yet: figures are month to date.</Text>}
        <Text style={s.note}>Net worth, income, spending and budgets are for {monthLabel(r.month)}. Insights, bills, the deposit or loan and the super cap are as at {fmtDate(r.today)}.</Text>

        <View style={s.footer} fixed>
          <Text>Generated {r.generatedAt} · {r.disclaimer}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

/** Render to a Blob in the browser (dynamic-imported by the Download button). */
export async function reportBlob(r: MonthlyReport, logoSrc?: string | null): Promise<Blob> {
  const { pdf } = await import('@react-pdf/renderer')
  return pdf(<ReportDocument r={r} logoSrc={logoSrc} />).toBlob()
}
