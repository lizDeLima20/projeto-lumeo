import type{TextAnchor}from"./HighlightManager";
export function expandSingleCharacterSelection(text:string,start:number,end:number):{start:number;end:number;selectedText:string}{
	const safeStart=Math.max(0,Math.min(start,text.length)),safeEnd=Math.max(safeStart,Math.min(end,text.length));
	let left=safeStart,right=safeEnd;
	const isWord=(character:string):boolean=>/[\p{L}\p{N}_'-]/u.test(character);
	if(right-left<=1&&isWord(text[safeStart]??"")){
		while(left>0&&isWord(text[left-1]??""))left--;
		while(right<text.length&&isWord(text[right]??""))right++;
	}
	while(left<right&&/\s/u.test(text[left]??""))left++;
	while(right>left&&/\s/u.test(text[right-1]??""))right--;
	return{start:left,end:right,selectedText:text.slice(left,right)};
}
export class TextSelectionManager{public selection(root:HTMLElement):TextAnchor|null{const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return null;const range=selection.getRangeAt(0),start=this.block(range.startContainer),end=this.block(range.endContainer);if(!start||start!==end||!root.contains(start))return null;const prefix=document.createRange();prefix.selectNodeContents(start);prefix.setEnd(range.startContainer,range.startOffset);const sourceText=start.textContent??"",rawStart=prefix.toString().length,rawEnd=rawStart+selection.toString().length,word=expandSingleCharacterSelection(sourceText,rawStart,rawEnd);if(!word.selectedText)return null;const sourceStart=Number(start.dataset.sourceStart??0);return{blockId:start.dataset.blockId??"",startOffset:sourceStart+word.start,endOffset:sourceStart+word.end,selectedText:word.selectedText};}public paragraph(root:HTMLElement):TextAnchor|null{const selection=window.getSelection();const block=selection?.anchorNode?this.block(selection.anchorNode):null;if(!block||!root.contains(block))return null;const sourceText=block.textContent??"",sourceStart=Number(block.dataset.sourceStart??0),word=expandSingleCharacterSelection(sourceText,0,sourceText.length);return{blockId:block.dataset.blockId??"",startOffset:sourceStart,endOffset:sourceStart+sourceText.length,selectedText:word.selectedText||sourceText.trim()};}public clear():void{window.getSelection()?.removeAllRanges();}private block(node:Node):HTMLElement|null{const element=node instanceof Element?node:node.parentElement;return element?.closest<HTMLElement>("[data-block-id]")??null;}}
