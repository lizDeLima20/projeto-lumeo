export class ImagePreloadPlanner{public adjacent(current:number,total:number):number[]{return[current-1,current+1,current+2].filter(page=>page>=1&&page<=total);}}
