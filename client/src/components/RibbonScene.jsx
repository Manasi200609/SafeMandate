/** Decorative glass-ribbon mark. It carries no transaction or payment state. */
export default function RibbonScene({ className = '' }) {
  return <svg className={`ribbon-scene ${className}`} viewBox="0 0 440 360" fill="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="ribbon-cyan" x1="46" y1="67" x2="365" y2="300" gradientUnits="userSpaceOnUse">
        <stop stopColor="#E7FFFF"/><stop offset=".18" stopColor="#16D6CF"/><stop offset=".55" stopColor="#00AFAE"/><stop offset=".82" stopColor="#0A4D54"/><stop offset="1" stopColor="#D8FFFF"/>
      </linearGradient>
      <linearGradient id="ribbon-edge" x1="84" y1="98" x2="353" y2="252" gradientUnits="userSpaceOnUse">
        <stop stopColor="#AFFFFB" stopOpacity=".08"/><stop offset=".42" stopColor="#FFFFFF" stopOpacity=".94"/><stop offset=".65" stopColor="#16D6CF" stopOpacity=".76"/><stop offset="1" stopColor="#BFFFFD" stopOpacity=".1"/>
      </linearGradient>
      <radialGradient id="ribbon-aura"><stop stopColor="#16D6CF" stopOpacity=".28"/><stop offset="1" stopColor="#16D6CF" stopOpacity="0"/></radialGradient>
      <filter id="ribbon-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="11"/></filter>
      <filter id="ribbon-soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2"/></filter>
    </defs>
    <ellipse cx="220" cy="190" rx="190" ry="150" fill="url(#ribbon-aura)"/>
    <g className="ribbon-rotate">
      <path className="ribbon-glow-path" d="M91 205C99 105 207 53 293 91C378 129 379 223 301 268C233 308 127 279 106 208C84 134 173 94 247 125C315 154 336 224 294 263C251 303 172 287 151 233C132 184 173 149 220 151C269 153 291 187 278 215" stroke="#16D6CF" strokeWidth="25" strokeLinecap="round" filter="url(#ribbon-glow)"/>
      <path d="M91 205C99 105 207 53 293 91C378 129 379 223 301 268C233 308 127 279 106 208C84 134 173 94 247 125C315 154 336 224 294 263C251 303 172 287 151 233C132 184 173 149 220 151C269 153 291 187 278 215" stroke="url(#ribbon-cyan)" strokeWidth="18" strokeLinecap="round"/>
      <path d="M91 205C99 105 207 53 293 91C378 129 379 223 301 268C233 308 127 279 106 208C84 134 173 94 247 125C315 154 336 224 294 263C251 303 172 287 151 233C132 184 173 149 220 151C269 153 291 187 278 215" stroke="url(#ribbon-edge)" strokeWidth="2.2" strokeLinecap="round" opacity=".9"/>
      <path d="M105 199C117 119 203 80 277 105C333 124 352 169 343 207" stroke="#E7FFFF" strokeWidth="1.4" strokeLinecap="round" opacity=".5" filter="url(#ribbon-soft)"/>
      <path d="M117 221C145 270 212 285 263 264" stroke="#C4FFFC" strokeWidth="1.3" strokeLinecap="round" opacity=".55"/>
      <circle cx="326" cy="112" r="2.5" fill="#E7FFFF"/><circle cx="112" cy="251" r="1.8" fill="#16D6CF"/><circle cx="343" cy="236" r="1.6" fill="#BFFFFD"/>
    </g>
  </svg>;
}
