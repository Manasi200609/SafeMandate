import { createContext, useCallback, useContext, useState } from 'react';
import Toast from './Toast.jsx';
const ToastContext=createContext(()=>{});
export function ToastProvider({children}){const [message,setMessage]=useState('');const notify=useCallback((text)=>setMessage(text),[]);return <ToastContext.Provider value={notify}>{children}<Toast message={message} onClose={()=>setMessage('')}/></ToastContext.Provider>}
export const useToast=()=>useContext(ToastContext);
