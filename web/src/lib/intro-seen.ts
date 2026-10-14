/**
 * Audit 80 B22 × E10 (integration): which "what this page is for" intros
 * (components/FirstVisitIntro) this browser has seen. The intro is in the
 * server HTML; this script, inline in <head>, hides the seen ones before the
 * first paint, so neither a first visit (intro appears after mount) nor a
 * return visit (intro removed after mount) moves the page.
 */
export const INTRO_SEEN_PREFIX = 'rd_intro_seen_';
export const INTRO_STYLE_ID = 'rd-intro-seen';

/** The CSS rule that hides one intro. Ids are letters, digits, - and _. */
export function introHideRule(id: string): string {
  return `[data-intro="${id.replace(/[^a-zA-Z0-9_-]/g, '')}"]{display:none}`;
}

export const INTRO_HIDE_SCRIPT =
  `try{var p=${JSON.stringify(INTRO_SEEN_PREFIX)},s='';` +
  `for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);` +
  `if(k&&k.indexOf(p)===0)s+='[data-intro="'+k.slice(p.length).replace(/[^a-zA-Z0-9_-]/g,'')+'"]{display:none}'}` +
  `var e=document.createElement('style');e.id=${JSON.stringify(INTRO_STYLE_ID)};e.textContent=s;document.head.appendChild(e)}catch(e){}`;
