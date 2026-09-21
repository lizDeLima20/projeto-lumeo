/** Connected paper surface. Integrating the tangent preserves horizontal arc length;
 * a moving fold crest leaves the unturned part flat instead of rotating a rigid card. */
export class PaperFoldGeometry {
  public build(width:number,_height:number,columns:number,rows:number,progress:number,direction:1|-1,touchX:number,touchY:number,speed:number):Float32Array {
    const clamp=(n:number)=>Math.max(0,Math.min(1,n));
    const p=clamp(progress),lift=Math.sin(Math.PI*p);
    const radius=.075+.055*(1-clamp(speed));
    const near=direction===1?touchX:1-touchX;
    const data=new Float32Array((columns+1)*(rows+1)*6);
    let offset=0;
    for(let row=0;row<=rows;row++){
      const v=row/rows;
      const corner=(.5-touchY)*(1-2*v)*.42*lift;
      const local=clamp(p+corner);
      const crest=1+radius-(1+2*radius)*local+.035*(near-.5)*lift;
      const angleAt=(u:number)=>{
        if(p===0)return 0;
        if(p===1)return Math.PI;
        const t=clamp((u-crest+radius)/(2*radius));
        return Math.PI*t*t*(3-2*t);
      };
      let x=0,z=0;
      for(let col=0;col<=columns;col++){
        const u=col/columns,angle=angleAt(u);
        if(col){const a=angleAt((col-.5)/columns);x+=Math.cos(a)*width/columns;z+=Math.sin(a)*width/columns;}
        const perspective=1/(1-z/(width*6));
        data[offset++]=col===0?0:direction*x*perspective/width;
        data[offset++]=(1-2*v)*perspective;
        // Greater height is closer to the camera, hence a smaller depth-buffer value.
        data[offset++]=-z/(width*2);
        data[offset++]=u;data[offset++]=v;
        data[offset++]=.78+.22*Math.abs(Math.cos(angle));
      }
    }
    return data;
  }
}
