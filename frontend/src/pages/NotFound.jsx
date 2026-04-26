import { useNavigate } from 'react-router-dom'
import styles from './NotFound.module.css'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className={styles.page}>
      <p className={styles.code}>404</p>
      <h1 className={styles.heading}>Page not found</h1>
      <p className={styles.sub}>The page you're looking for doesn't exist or has been moved.</p>
      <button className={styles.btn} onClick={() => navigate('/')}>Go home</button>
    </div>
  )
}
