const test=require('node:test'),assert=require('node:assert/strict');
const {patchChildren}=require('../web/dom-patch');
// Small DOM adapter: test the renderer's actual identity and attribute writes without a browser dependency.
class Node {
 constructor(tag,attrs={},children=[]){this.nodeType=tag==='#text'?3:1;this.nodeName=tag;this.attrs={...attrs};this.nodeValue=this.nodeType===3?attrs.text:null;this.childNodes=[];this.writes=[];children.forEach(n=>this.insertBefore(n,null));}
 get attributes(){return Object.entries(this.attrs).map(([name,value])=>({name,value}));}
 getAttribute(name){return this.attrs[name]??null;}
 setAttribute(name,value){this.writes.push(name);this.attrs[name]=value;}
 removeAttribute(name){delete this.attrs[name];}
 insertBefore(node,ref){if(node.parentNode)node.parentNode.removeChild(node);const index=ref?this.childNodes.indexOf(ref):this.childNodes.length;this.childNodes.splice(index,0,node);node.parentNode=this;}
 removeChild(node){this.childNodes.splice(this.childNodes.indexOf(node),1);node.parentNode=null;}
 cloneNode(deep){return new Node(this.nodeName,this.attrs,deep?this.childNodes.map(n=>n.cloneNode(true)):[]);}
}
const seat=(id,count,avatar='cat.jpg')=>new Node('DIV',{'data-render-key':'seat:'+id},[new Node('IMG',{src:avatar}),new Node('#text',{text:String(count)})]);
test('local rerender and changed counts retain decoded avatar nodes without rewriting image source',()=>{
 const a=seat('a',8),b=seat('b',8),root=new Node('DIV',{},[a,b]),image=a.childNodes[0];
 patchChildren(root,new Node('DIV',{},[seat('a',7),seat('b',8)]));
 assert.equal(root.childNodes[0],a);assert.equal(a.childNodes[0],image);assert.deepEqual(image.writes,[]);assert.equal(a.childNodes[1].nodeValue,'7');
 patchChildren(root,new Node('DIV',{},[seat('a',7),seat('b',8)]));assert.equal(a.childNodes[0],image);assert.deepEqual(image.writes,[]);
});
test('keyed seats move with players, new avatar changes src once, removed players disappear',()=>{
 const a=seat('a',8),b=seat('b',8),root=new Node('DIV',{},[a,b]);
 patchChildren(root,new Node('DIV',{},[seat('b',6),seat('a',8,'new.jpg')]));
 assert.equal(root.childNodes[0],b);assert.equal(root.childNodes[1],a);assert.deepEqual(a.childNodes[0].writes,['src']);
 patchChildren(root,new Node('DIV',{},[seat('a',8,'new.jpg')]));assert.deepEqual(root.childNodes,[a]);
});
test('new modal siblings do not replace existing board, removed boolean attributes enable actions',()=>{
 const board=seat('a',8),button=new Node('BUTTON',{'data-action':'draw',disabled:''}),root=new Node('DIV',{},[board,button]);
 patchChildren(root,new Node('DIV',{},[seat('a',8),new Node('BUTTON',{'data-action':'draw'}),new Node('SECTION',{role:'dialog'})]));
 assert.equal(root.childNodes[0],board);assert.equal(root.childNodes[1],button);assert.equal(button.getAttribute('disabled'),null);assert.equal(root.childNodes.length,3);
});
test('same-action time options keep separate identities and all three buttons remain after selection',()=>{
 const option=s=>new Node('BUTTON',{'data-action':'nope-time','data-seconds':String(s)});
 const buttons=[15,10,5].map(option),root=new Node('DIV',{},buttons);
 patchChildren(root,new Node('DIV',{},[15,10,5].map(option)));
 assert.equal(root.childNodes.length,3);assert(root.childNodes.every((node,i)=>node===buttons[i]));
});
