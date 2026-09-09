import assert from"node:assert/strict";import{describe,it}from"node:test";import{PageGeometry}from"../src/reader/page-turn/PageGeometry";import{PageCurlGeometry}from"../src/reader/page-turn/PageCurlGeometry";import{readFileSync}from"node:fs";import{PageShadowRenderer}from"../src/reader/page-turn/PageShadowRenderer";import{PageGestureController}from"../src/reader/page-turn/PageGestureController";import{PageSpreadController}from"../src/reader/page-turn/PageSpreadController";import{PageTurnEngine}from"../src/reader/page-turn/PageTurnEngine";
const element=()=>({clientWidth:400,classList:{add(){},remove(){}},style:{willChange:"",setProperty(){},removeProperty(){}},animate(){return{finished:Promise.resolve()}}})as unknown as HTMLElement;
describe("PageTurnEngine",()=>{it("dragProgress e geometria respondem continuamente",()=>{const geometry=new PageGeometry();assert.equal(geometry.calculate(0,400,1).progress,0);assert.equal(geometry.calculate(-200,400,1).progress,.5);assert.equal(geometry.calculate(-800,400,1).progress,1)});it("a folha e um retangulo perfeito, sem dobra nem esmagamento",()=>{const geometry=new PageGeometry();for(const at of [-40,-200,-320,-400]){const step=geometry.calculate(at,400,1);assert.equal(step.skewY,0);assert.equal(step.scaleX,1);assert.equal(step.curlInset,0);assert.equal(step.curlTail,0);assert.equal(step.curlRadius,0);assert.equal(step.translateX,0);}});it("a folha acompanha o dedo linearmente e pousa deitada",()=>{const geometry=new PageGeometry();assert.equal(geometry.calculate(-100,400,1).angle,-PageGeometry.landingAngle*.25);assert.equal(geometry.calculate(-200,400,1).angle,-PageGeometry.landingAngle*.5);assert.equal(geometry.calculate(-400,400,1).angle,-PageGeometry.landingAngle);assert.ok(PageGeometry.landingAngle>170);assert.equal(geometry.calculate(-200,400,-1).angle,PageGeometry.landingAngle*.5);});it("o verso opaco assume exatamente aos 90 graus, e nao ha gradiente na borda direita",()=>{const geometry=new PageGeometry(),shadows=new PageShadowRenderer(),written=new Map<string,string>();const page={style:{setProperty(key:string,value:string){written.set(key,value)},removeProperty(){}}}as unknown as HTMLElement;assert.equal(PageShadowRenderer.hasRightEdgeFoldGradient,false);shadows.render(page,null,geometry.calculate(-400*.2,400,1));assert.equal(written.get("--verso-opacity"),"0");shadows.render(page,null,geometry.calculate(-400*.7,400,1));assert.equal(written.get("--verso-opacity"),"1");});it("velocity é calculada em px/ms",()=>{const gesture=new PageGestureController();gesture.start(300,0);const sample=gesture.update(200,100);assert.equal(sample.velocityX,-1);assert.equal(sample.direction,1)});it("threshold e velocidade decidem complete/return",()=>{const engine=new PageTurnEngine(element(),null,()=>{});assert.equal(engine.shouldComplete(.36,-.1,1),true);assert.equal(engine.shouldComplete(.2,-.8,1),true);assert.equal(engine.shouldComplete(.2,-.1,1),false)});it("animationStateLock impede gesto concorrente",()=>{const engine=new PageTurnEngine(element(),null,()=>{});assert.equal(engine.begin(100,0),true);assert.equal(engine.begin(120,2),false);assert.equal(engine.state,"DRAGGING")});});
describe("PageSpreadController",()=>{it("nextPage previousPage e limites",()=>{const mobile=new PageSpreadController(5,1);assert.equal(mobile.next(1),2);assert.equal(mobile.previous(1),1);assert.equal(mobile.next(5),5);const desktop=new PageSpreadController(10,2);assert.equal(desktop.next(4),6);assert.equal(desktop.previous(4),2)})});

describe("PageCurlGeometry",()=>{
  const curl=new PageCurlGeometry(),L=PageGeometry.landingAngle,W=560;
  it("a folha e plana parada, curva no meio do gesto e plana ao pousar",()=>{
    assert.ok(Math.abs(curl.bendAt(0))<1e-9);assert.ok(Math.abs(curl.bendAt(1))<1e-9);
    assert.ok(curl.bendAt(.5)>25,"tem que curvar no meio");
    const landed=curl.build(1,W,L,1);
    assert.ok(landed.every(strip=>Math.abs(strip.angle-landed[0]!.angle)<1e-9),"pousada, todas as tiras no mesmo angulo");
  });
  it("a ponta acompanha o dedo e a base fica para tras",()=>{
    const mid=curl.build(.5,W,L,1);
    assert.ok(Math.abs(mid[mid.length-1]!.angle)>Math.abs(mid[0]!.angle),"a ponta gira mais que a base");
    assert.ok(Math.abs(Math.abs(mid[mid.length-1]!.angle)-L*.5)<3,"a ponta segue o dedo");
  });
  it("a folha curva nunca desaparece, a placa rigida sim",()=>{
    // a flat plate projects to zero width at 90deg - the middle of the gesture had
    // nothing on screen but the cast shadow, which is what read as a grey roll
    let worstCurl=1,worstFlat=1;
    for(let step=0;step<=200;step+=1){
      const progress=step/200,strips=curl.build(progress,W,L,1);
      const projected=strips.reduce((sum,strip)=>sum+Math.abs(Math.cos(strip.angle*Math.PI/180))*strip.width,0)/W;
      worstCurl=Math.min(worstCurl,projected);
      worstFlat=Math.min(worstFlat,Math.abs(Math.cos(L*progress*Math.PI/180)));
    }
    assert.ok(worstCurl>.1,`folha curva some (${worstCurl})`);
    assert.ok(worstFlat<.01,"a placa rigida some - e por isso que ela foi substituida");
  });
  it("o sombreamento e continuo entre tiras vizinhas",()=>{
    // a single value per strip made every seam a visible step: the banding
    for(const progress of [.15,.35,.5,.7,.9]){
      const strips=curl.build(progress,W,L,1);
      for(let index=0;index+1<strips.length;index+=1){
        assert.ok(Math.abs(strips[index]!.shadeEnd-strips[index+1]!.shadeStart)<1e-9,
          `costura visivel entre as tiras ${index} e ${index+1} em ${progress}`);
      }
    }
  });
  it("a sobra anti-costura cresce quando a tira fica de perfil",()=>{
    const step=W/PageCurlGeometry.strips;
    assert.ok(curl.bleedFor(85,step)>curl.bleedFor(20,step)*3,"de perfil precisa de muito mais sobra");
    assert.ok(curl.bleedFor(89.9,step)<=step*.85,"nunca engole a tira seguinte");
  });
  it("a folha nao pode carregar overflow nem filter - achatam o arco",()=>{
    const css=readFileSync("src/styles/reader.css","utf8");
    const rule=css.slice(css.indexOf(".page-turn-active,"),css.indexOf("}",css.indexOf(".page-turn-active,")));
    assert.ok(rule.includes("overflow:visible"),rule);
    assert.ok(rule.includes("transform-style:preserve-3d"),rule);
    assert.equal(rule.includes("filter:"),false,"filter e propriedade de agrupamento: achataria o 3D");
  });
});
