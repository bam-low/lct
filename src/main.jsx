import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { preloadRobotModels } from './simulation/robots/models.js'

// 3D-модели роботов грузятся, пока пользователь на экране настроек, — к
// открытию симуляции они уже готовы, и сцена не ждёт файлы.
preloadRobotModels()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
