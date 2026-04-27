import { useStore } from '../store/useStore'
import styles from './ScreenTransition.module.css'

export default function ScreenTransition() {
  const { transitionActive } = useStore()

  return (
    <div
      className={`${styles.overlay} ${transitionActive ? styles.visible : ''}`}
      aria-hidden={!transitionActive}
    />
  )
}
