import type { Book } from "../models/Book";
import { BookSelectionController } from "./BookSelectionController";
import { Book3DShell, type Book3DMode } from "./Book3DShell";
import type { BookVisualMode } from "./BookPerspectiveLayout";
import { BookInteractionRegion } from "./BookInteractionRegion";
import { I18nManager } from "../i18n/I18nManager";

export class BookShelfCard3D {
  public static readonly usesDedicatedVisibleHitRegion = true;
  public static readonly supportsContextDelete = true;
  public static readonly longPressDeleteMenuMs = 620;
  public constructor(private readonly book:Book,private readonly onOpen:(bookId:string)=>void,private readonly selection=new BookSelectionController(),private readonly mode:BookVisualMode="FRONT",private readonly showAuthor=true,private readonly onDelete?:(bookId:string)=>void|Promise<void>){}
  public render():HTMLElement&{disabled?:boolean} {
    const card:HTMLDivElement&{disabled?:boolean}=document.createElement("div");card.disabled=false;card.className="book-card";card.dataset.bookId=this.book.id;card.dataset.visualMode=this.mode;card.setAttribute("role","button");card.tabIndex=0;card.setAttribute("aria-label",`Abrir ${this.book.title}`);
    const shell=new Book3DShell(this.book,this.shellMode(),this.showAuthor).render(),info=document.createElement("span");info.className="book-card__info";
    const title=document.createElement("strong"),author=document.createElement("span");title.className="book-card__title";title.textContent=this.book.title;author.className="book-card__author";author.textContent=this.book.author||"Autor desconhecido";info.append(title,author);
    if(this.book.progressPercent!==undefined){const progress=document.createElement("span"),bar=document.createElement("span"),label=document.createElement("span");progress.className="book-progress";bar.style.width=`${Math.min(100,Math.max(0,this.book.progressPercent))}%`;label.className="book-progress-label";label.textContent=`${Math.round(this.book.progressPercent)}% lido`;progress.append(bar);info.append(progress,label);}
    const interaction=new BookInteractionRegion();
    const activate=(activation:"selected"|"activated")=>{
      /* Selection is stable until a real outside press.  A second press on the
         same visible volume opens it; it must never turn into a deselection. */
      if(activation==="activated"){
        card.classList.add("book-card--selected","book-card--activating");
        this.onOpen(this.book.id);
        return;
      }
      card.classList.add("book-card--selected");
      if(this.mode!=="FRONT")shell.dataset.mode="FOCUSED_ANGLED";
      this.onOpen(this.book.id);
    };
    card.append(shell,info);shell.addEventListener("click",(event)=>{if(card.disabled)return;const activation=interaction.activate(this.selection,this.book.id,event.target,shell);if(activation==="ignored")return;event.stopPropagation();activate(activation);});
    this.bindDeleteMenu(card,shell);
    card.addEventListener("keydown",event=>{if(card.disabled||(event.key!=="Enter"&&event.key!==" "))return;event.preventDefault();activate(this.selection.activate(this.book.id));});return card;
  }
  private shellMode():Book3DMode{return this.mode==="FRONT"?"FRONT":this.mode==="FOCUSED_ANGLED"?"FOCUSED_ANGLED":"ANGLED";}
  private bindDeleteMenu(card:HTMLElement&{disabled?:boolean},shell:HTMLElement):void{
    if(!this.onDelete)return;let timer=0,menu:HTMLElement|null=null,moved=false,startX=0,startY=0;
    const close=()=>{menu?.remove();menu=null;};
    const open=(x:number,y:number)=>{close();menu=document.createElement("div");menu.className="book-context-menu";menu.style.left=`${x}px`;menu.style.top=`${y}px`;const button=document.createElement("button");button.type="button";button.className="book-context-menu__item";button.textContent=I18nManager.shared.t("library.deleteBook");button.addEventListener("click",async event=>{event.stopPropagation();close();if(!confirm(I18nManager.shared.t("library.deleteConfirm")))return;card.disabled=true;await this.onDelete?.(this.book.id);});menu.append(button);document.body.append(menu);window.setTimeout(()=>document.addEventListener("pointerdown",close,{once:true}),0);};
    shell.addEventListener("contextmenu",event=>{event.preventDefault();event.stopPropagation();open(event.clientX,event.clientY);});
    shell.addEventListener("pointerdown",event=>{if(event.button!==0)return;moved=false;startX=event.clientX;startY=event.clientY;window.clearTimeout(timer);timer=window.setTimeout(()=>open(event.clientX,event.clientY),BookShelfCard3D.longPressDeleteMenuMs);},{passive:true});
    shell.addEventListener("pointermove",event=>{if(Math.hypot(event.clientX-startX,event.clientY-startY)>10){moved=true;window.clearTimeout(timer);}}, {passive:true});
    shell.addEventListener("pointerup",()=>{if(!moved)window.clearTimeout(timer);}, {passive:true});
    shell.addEventListener("pointercancel",()=>window.clearTimeout(timer), {passive:true});
  }
}
