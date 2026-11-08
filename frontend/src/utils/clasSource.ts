/**
 * CLAS L6 source in the NMEA GGA station id (MRTKLIB >= 0.7.15, #144;
 * MRTKLIB docs/guide/quickstart-clas.md "GGA Station ID: CLAS L6 Source").
 *
 *   id = P1*100 + P2*10 + F      (0000-0779)
 *   P1 / P2  L6 PRN - 192 of channel 1 / 2 (0 = no corrections on it)
 *   F        facility id + 1 (1-4); 9 = the two channels' facilities differ
 *
 * 0000 = no CLAS corrections (SPP epochs, other modes, older MRTKLIB, files
 * written with clas_nmea_source_id off): not an error, just no source.
 */

export interface ClasSource {
  /** L6 PRN of channel 1 / 2, null when that channel had no corrections. */
  prn1: number | null;
  prn2: number | null;
  /** Facility as MRTKLIB numbers it (F = 1-4); null when they differ. */
  facility: number | null;
  /** F = 9: the two channels carry different facilities. */
  facilityMismatch: boolean;
}

/** The decoded source, or null for 0000 / no id / a value that does not
 *  follow the encoding (e.g. another receiver's base station id). */
export function decodeClasSource(id: number | null | undefined): ClasSource | null {
  if (id == null || !Number.isInteger(id) || id <= 0 || id > 779) return null;
  const p1 = Math.floor(id / 100);
  const p2 = Math.floor(id / 10) % 10;
  const f = id % 10;
  if (p1 === 0 && p2 === 0) return null;
  if (!((f >= 1 && f <= 4) || f === 9)) return null;
  return {
    prn1: p1 ? 192 + p1 : null,
    prn2: p2 ? 192 + p2 : null,
    facility: f === 9 ? null : f,
    facilityMismatch: f === 9,
  };
}

/** e.g. "PRN 194+196 · facility 3", "PRN 193 · facility 1",
 *  "PRN 196+197 · facilities differ", "ch2 PRN 194 · facility 2". */
export function formatClasSource(s: ClasSource): string {
  const prns = s.prn1 && s.prn2
    ? `PRN ${s.prn1}+${s.prn2}`
    : s.prn1
      ? `PRN ${s.prn1}`
      : `ch2 PRN ${s.prn2}`;
  return `${prns} · ${s.facilityMismatch ? 'facilities differ' : `facility ${s.facility}`}`;
}

/** Short form for chart markers: "194+196 F3", "193 F1", "196+197 F≠". */
export function shortClasSource(s: ClasSource): string {
  const prns = [s.prn1 ?? '–', s.prn2].filter((x) => x != null).join('+');
  return `${prns} ${s.facilityMismatch ? 'F≠' : `F${s.facility}`}`;
}

/** Where the L6 source changes along the epochs (QZSS handover, facility
 *  switch). Epochs without a source (0000) are skipped, so a Single gap does
 *  not count as a change. The first source is included as the start. */
export function clasSourceChanges<T extends { timeUnix: number; refid?: number | null }>(
  epochs: T[],
): { timeUnix: number; id: number; source: ClasSource }[] {
  const out: { timeUnix: number; id: number; source: ClasSource }[] = [];
  let lastId: number | null = null;
  for (const e of epochs) {
    const source = decodeClasSource(e.refid);
    if (!source || e.refid === lastId) continue;
    lastId = e.refid as number;
    out.push({ timeUnix: e.timeUnix, id: lastId, source });
  }
  return out;
}
