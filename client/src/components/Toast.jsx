import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
export default function Toast({message,onClose}){const { t } = useTranslation();
useEffect(()=>{if(!message)return;const id=setTimeout(onClose,3600);return()=>clearTimeout(id);},[message,onClose]);return <AnimatePresence>{message&&<motion.div className="toast" role="status" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}><span className="toast-check"><Check size={15}/></span><span>{message}</span><button aria-label={t("copy.dismiss_message_98f3b0e")} onClick={onClose}><X size={15}/></button></motion.div>}</AnimatePresence>}
