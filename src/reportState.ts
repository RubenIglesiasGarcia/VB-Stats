import type {AutoAnalysis} from './automatic';
import type {MatchEvent} from './model';

/** An empty/unfinished analysis must never unlock a misleading export. */
export function hasAutomaticReport(data:AutoAnalysis|null|undefined):boolean{
  return Boolean(data&&(data.events.length>0||data.rallies.length>0));
}

/** Only actual manual annotations count as a manual report. */
export function hasManualReport(events:MatchEvent[]|null|undefined):boolean{
  return Boolean(events&&events.length>0);
}
