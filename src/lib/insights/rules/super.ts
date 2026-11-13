// FHSS window and concessional cap headroom: time-sensitive, close on 30 June.

import { annualTakeHome } from '../../tax/takeHome'
import { fyOf } from '../../tax/config'
import { fhssVsCash } from '../../house/fhss'
import { FHSS } from '../../house/rules'
import { dayDiff } from '../../import/dates'
import { dollars } from '../history'
import type { Insight, InsightContext, InsightPerson } from '../types'

/** 30 June ending the FY that contains `today`, and the months left in it (this one included). */
export function fyWindow(today: string) {
  const fy = fyOf(today)
  const endYear = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 7 ? 1 : 0)
  const end = `${endYear}-06-30`
  return { fy, end, endYear, daysLeft: dayDiff(today, end), monthsLeft: (endYear - Number(today.slice(0, 4))) * 12 + 6 - Number(today.slice(5, 7)) + 1 }
}

const eofy = (today: string) => ['04', '05', '06'].includes(today.slice(5, 7))

/** Concessional cap room left this FY: cap − SG on the salary − voluntary contributions entered. */
export function capRoom(p: InsightPerson, today: string) {
  const b = annualTakeHome({ grossCents: p.grossCents, hasPrivateHospital: p.hasPrivateHospital, hasHecs: p.hasHecs }, fyOf(today))
  return { breakdown: b, roomCents: b.capHeadroomCents - p.voluntaryConcessionalCents }
}

export const FHSS_WINDOW = { showWithinMonths: 8 }

export function fhssWindow(ctx: InsightContext): Insight[] {
  const h = ctx.house
  if (!h || !h.firstHome || h.date < ctx.today) return []
  const w = fyWindow(ctx.today)
  if (w.monthsLeft > FHSS_WINDOW.showWithinMonths) return []
  const release = ctx.fhssReleaseMonth
  const rows = ctx.people.filter(p => p.grossCents > 0).map(p => {
    const { breakdown, roomCents } = capRoom(p, ctx.today)
    const room = Math.max(0, Math.min(FHSS.perFyCapCents, roomCents))
    // Modelled gain for this FY's room only: contributions to 30 June, released the month after.
    const gain = room > 0 ? fhssVsCash({
      person: { name: p.name, grossCents: p.grossCents, hasPrivateHospital: p.hasPrivateHospital, hasHecs: p.hasHecs, existingSacrificeCents: p.voluntaryConcessionalCents },
      startMonth: ctx.thisMonth, releaseMonth: `${w.endYear}-07`, annualContributionCents: room, cashRatePct: ctx.cashRatePct,
    }).gainCents : 0
    return { p, room, gain, sg: breakdown.sgCents }
  }).filter(r => r.room > 0)
  if (!rows.length) return []
  const gain = rows.reduce((s, r) => s + Math.max(0, r.gain), 0)
  const same = rows.length > 1 && rows.every(r => r.room === rows[0].room)
  const who = same ? `You each have ${dollars(rows[0].room)}` : rows.map(r => `${r.p.name} has ${dollars(r.room)}`).join(' and ')
  return [{
    key: `fhss-window:${w.fy}`,
    rule: 'fhss_window',
    title: `${who} of FHSS room this financial year (closes 30 June)`,
    detail: `Modelled tax saving vs saving the same pre-tax pay as cash: about ${dollars(gain)} for this year's room. Room is the $15,000 FHSS yearly limit or what's left of the concessional cap after employer super${ctx.fhssOn ? ' and the salary sacrifice already in your plan' : ''}, whichever is lower.${release ? ` House › FHSS times the release for ${release}.` : ''}` +
      (ctx.fhssMonths ? ` Deposit days assume salary-sacrificing that much a year into FHSS until the release (less take-home now, released, less tax, the month before you buy): an estimate.` : ''),
    impactCents: gain,
    impactLabel: `~${dollars(gain)} saved`,
    depositEffect: ctx.fhssMonths ? { sacrifice: rows.map(r => ({ personKey: r.p.key, annualCents: r.room })), fhss: ctx.fhssMonths } : null,
    depositNote: ctx.fhssMonths ? undefined : 'The house month is too close for an FHSS release to land before it.',
    evidence: rows.map(r => ({ kind: 'row' as const, label: r.p.name, value: `${dollars(r.room)} room (employer super ${dollars(r.sg)}); modelled gain ${dollars(r.gain)}` })),
    href: '/house#fhss',
    hrefLabel: 'House › FHSS',
    timeSensitive: true,
  }]
}

export const CAP_HEADROOM = { minRoomCents: 100_000 }

/** Unused concessional cap, flagged in April–June only (carry-forward isn't modelled). */
export function capHeadroom(ctx: InsightContext): Insight[] {
  if (!eofy(ctx.today)) return []
  const { fy } = fyWindow(ctx.today)
  return ctx.people.filter(p => p.grossCents > 0).flatMap(p => {
    const { breakdown, roomCents } = capRoom(p, ctx.today)
    if (roomCents < CAP_HEADROOM.minRoomCents) return []
    const taxRate = Math.max(0, breakdown.marginalRate + 0.02 - 0.15)
    const saving = Math.round(roomCents * taxRate)
    return [{
      key: `cap-headroom:${p.key}:${fy}`,
      rule: 'cap_headroom' as const,
      title: `${p.name} has ${dollars(roomCents)} of concessional cap unused this financial year`,
      detail: `Cap ${dollars(breakdown.concessionalCapCents)} less employer super ${dollars(breakdown.sgCents)}${p.voluntaryConcessionalCents ? ` and ${dollars(p.voluntaryConcessionalCents)} you've entered` : ''}. Pre-tax contributions are taxed at 15% in super instead of ${Math.round((breakdown.marginalRate + 0.02) * 100)}%: up to about ${dollars(saving)} less tax if the whole room were used. Carry-forward of unused cap from earlier years isn't counted.`,
      impactCents: saving,
      impactLabel: `up to ${dollars(saving)} tax`,
      depositEffect: null,
      depositNote: 'Super doesn’t count toward the deposit; contributions lower take-home pay.',
      evidence: [
        { kind: 'row' as const, label: 'Gross salary', value: dollars(p.grossCents) },
        { kind: 'row' as const, label: 'Employer super (SG)', value: dollars(breakdown.sgCents) },
        { kind: 'row' as const, label: 'Voluntary entered', value: dollars(p.voluntaryConcessionalCents) },
      ],
      href: '/income#super',
      hrefLabel: 'Super cap tracker',
      timeSensitive: true,
    }]
  })
}
