export type PremiumPageAnimation="none"|"slide"|"page-turn"|"soft";
export class ReaderAnimationPolicy{public resolve(value:PremiumPageAnimation,reducedMotion:boolean):PremiumPageAnimation{return reducedMotion&&value!=="none"?"none":value;}}
