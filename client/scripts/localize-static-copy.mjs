import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from '@babel/parser';

const root=path.resolve('src');
const copyFile=path.resolve('src/locales/en/translation.json');
const translations={};
const pending=[];
const attrNames=new Set(['aria-label','placeholder','title','alt','aria-description']);

function keyFor(value){
  if(translations[value])return translations[value];
  const slug=value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,38)||'copy';
  const digest=crypto.createHash('sha1').update(value).digest('hex').slice(0,7);
  const key=`copy.${slug}_${digest}`;
  translations[value]=key;
  return key;
}
function meaningfulSibling(node){return node&&node.type!=='JSXText';}
function normalizedText(node,parent){
  const raw=node.value;
  const lines=raw.split(/\r\n|\n|\r/);
  let value=lines.map((line,index)=>{
    if(index>0)line=line.replace(/^\s+/,'');
    if(index<lines.length-1)line=line.replace(/\s+$/,'');
    return line;
  }).filter(line=>line.trim().length).join(' ');
  if(!value.trim())return '';
  const kids=parent?.children??[];const index=kids.indexOf(node);
  const prev=kids.slice(0,index).reverse().find(item=>item.type!=='JSXText'||item.value.trim());
  const next=kids.slice(index+1).find(item=>item.type!=='JSXText'||item.value.trim());
  if(prev&&meaningfulSibling(prev)&&/^\s/.test(raw))value=` ${value}`;
  if(next&&meaningfulSibling(next)&&/\s$/.test(raw))value=`${value} `;
  return value;
}

function visit(node,parent=null,componentStack=[]){
  if(!node||typeof node!=='object')return;
  let stack=componentStack;
  if(node.type==='FunctionDeclaration'&&node.id?.name&&/^[A-Z]/.test(node.id.name))stack=[...stack,node];
  if(node.type==='JSXText'){
    const value=normalizedText(node,parent);
    if(value){const key=keyFor(value);pending.push({start:node.start,end:node.end,text:`{t(${JSON.stringify(key)})}`,component:stack.at(-1),source:node});}
  }
  if(node.type==='JSXAttribute'&&attrNames.has(node.name?.name)&&node.value?.type==='StringLiteral'){
    const value=node.value.value;
    if(value){const key=keyFor(value);pending.push({start:node.start,end:node.end,text:`${node.name.name}={t(${JSON.stringify(key)})}`,component:stack.at(-1),source:node});}
  }
  for(const [key,value] of Object.entries(node)){
    if(key==='loc'||key==='start'||key==='end'||key==='extra')continue;
    if(Array.isArray(value))for(const child of value)visit(child,node,stack);
    else if(value&&typeof value==='object'&&typeof value.type==='string')visit(value,node,stack);
  }
}

function filesIn(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?filesIn(path.join(dir,entry.name)):[path.join(dir,entry.name)]).filter(file=>file.endsWith('.jsx'));}
for(const file of filesIn(root)){
  const source=fs.readFileSync(file,'utf8');
  const ast=parse(source,{sourceType:'module',plugins:['jsx']});
  pending.length=0;visit(ast);
  if(!pending.length)continue;
  const componentEdits=new Map();
  for(const edit of pending)if(edit.component)componentEdits.set(edit.component.body.start+1,edit.component);
  const edits=[...pending.map(({start,end,text})=>({start,end,text}))];
  for(const [position] of componentEdits)edits.push({start:position,end:position,text:'const { t } = useTranslation();\n'});
  if(!source.includes("from 'react-i18next'")){
    const firstImport=ast.program.body.find(statement=>statement.type==='ImportDeclaration');
    edits.push({start:firstImport?.start??0,end:firstImport?.start??0,text:"import { useTranslation } from 'react-i18next';\n"});
  }
  edits.sort((a,b)=>b.start-a.start||b.end-a.end);
  let changed=source;
  for(const edit of edits)changed=changed.slice(0,edit.start)+edit.text+changed.slice(edit.end);
  fs.writeFileSync(file,changed);
}
fs.mkdirSync(path.dirname(copyFile),{recursive:true});
fs.writeFileSync(copyFile,JSON.stringify(Object.fromEntries(Object.entries(translations).map(([value,key])=>[key,value])),null,2)+'\n');
console.log(`Localized ${Object.keys(translations).length} static copy strings.`);
