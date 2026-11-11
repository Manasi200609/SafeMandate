import { motion } from 'framer-motion';
import { pageVariants } from '../motion/variants.js';
export default function PageFrame({children,className=''}){return <motion.main className={className} variants={pageVariants} initial="initial" animate="animate" exit="exit">{children}</motion.main>}
