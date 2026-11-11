import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line } from 'recharts';
import { currentLocale, numberLabel } from '../services/format.js';

const accent='#D9FF32';
const steel='#16D8E7';
const muted='#929292';
const grid='#303030';
const outcomes=['#777777','#D6B955',accent,'#E17878'];
const categories=[accent,'#16D8E7','#A8A8A8','#D6B955','#57D9B1'];
const tooltip={
  contentStyle:{background:'#151515',border:'1px solid #303030',borderRadius:8,color:'#F6F6F4',fontSize:12,padding:'10px 12px'},
  labelStyle:{color:'#B0B0B0',marginBottom:4},
  itemStyle:{color:'#D9FF32'},
  cursor:{fill:'rgba(255,255,255,.045)'},
};

function useInitialChartAnimation(){
  const [active,setActive]=useState(true);
  useEffect(()=>{const timer=setTimeout(()=>setActive(false),700);return()=>clearTimeout(timer);},[]);
  return active;
}

function Empty({messageKey}){
  const {t}=useTranslation();
  return <div className="chart-empty"><span className="empty-mark">—</span><p>{t(messageKey)}</p></div>;
}

function Axis({format}){
  return <YAxis allowDecimals={false} tickFormatter={format} tick={{fill:muted,fontSize:11}} axisLine={false} tickLine={false} width={34}/>;
}

export function WeeklyChart({data}){
  const {t}=useTranslation();
  const animate=useInitialChartAnimation();
  if(!data.some(d=>d.proposals))return <Empty messageKey="chart.noProposals"/>;
  return <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{top:8,right:8,left:0,bottom:0}}>
    <defs><linearGradient id="weeklyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={accent} stopOpacity={.12}/><stop offset="100%" stopColor={accent} stopOpacity={0}/></linearGradient></defs>
    <CartesianGrid stroke={grid} strokeDasharray="0" vertical={false}/><XAxis dataKey="day" tick={{fill:muted,fontSize:11}} axisLine={false} tickLine={false} tickMargin={8}/><Axis/><Tooltip {...tooltip}/>
    <Area isAnimationActive={animate} animationDuration={450} type="monotone" dataKey="proposals" name={t('chart.proposals')} stroke={accent} strokeWidth={1.7} fill="url(#weeklyFill)" activeDot={{r:3,fill:accent,stroke:'#090909',strokeWidth:1.5}}/>
  </AreaChart></ResponsiveContainer>;
}

export function OutcomeChart({data}){
  const {t}=useTranslation();
  const animate=useInitialChartAnimation();
  return <ResponsiveContainer width="100%" height="100%"><PieChart>
    <Pie isAnimationActive={animate} animationDuration={450} data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="86%" paddingAngle={3} stroke="#151515" strokeWidth={2}>{data.map((d,i)=><Cell key={d.name} fill={outcomes[i%outcomes.length]}/>)}</Pie>
    <Tooltip {...tooltip} labelFormatter={value=>t(value,{defaultValue:value})} formatter={value=>[numberLabel(Number(value)),t('chart.transactions')]}/>
  </PieChart></ResponsiveContainer>;
}

export function CategoryChart({data}){
  const {t}=useTranslation();
  const animate=useInitialChartAnimation();
  if(!data.length)return <Empty messageKey="chart.noCategories"/>;
  return <ResponsiveContainer width="100%" height="100%"><PieChart><Pie isAnimationActive={animate} animationDuration={450} data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="83%" paddingAngle={2} stroke="#151515" strokeWidth={2}>{data.map((d,i)=><Cell key={d.name} fill={categories[i%categories.length]}/>)}</Pie><Tooltip {...tooltip} labelFormatter={value=>t(`category.${value}`,{defaultValue:value})} formatter={value=>new Intl.NumberFormat(currentLocale(),{style:'currency',currency:'INR'}).format(Number(value))}/></PieChart></ResponsiveContainer>;
}

export function UtilizationChart({data,captured}){
  const {t}=useTranslation();
  const animate=useInitialChartAnimation();
  if(!captured)return <Empty messageKey="chart.noCaptured"/>;
  return <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{top:10,right:10,left:0,bottom:0}}>
    <CartesianGrid stroke={grid} strokeDasharray="0" vertical={false}/><XAxis dataKey="period" tick={{fill:muted,fontSize:10}} axisLine={false} tickLine={false} tickMargin={8}/><YAxis domain={[0,100]} tick={{fill:muted,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={value=>`${value}%`} width={40}/><Tooltip {...tooltip} formatter={value=>`${value}%`}/>
    <Line isAnimationActive={animate} animationDuration={450} type="monotone" dataKey="value" name={t('chart.mandateUsed')} stroke={steel} strokeWidth={1.6} dot={{r:2,fill:steel,stroke:'#090909',strokeWidth:1}}/>
  </LineChart></ResponsiveContainer>;
}
