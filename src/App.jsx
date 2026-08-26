import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import Customers from './pages/Customers'
import RoleAccess from './pages/RoleAccess'
import Profile from './pages/Profile'
import ComingSoon from './pages/ComingSoon'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<ComingSoon title="Clients" />} />
          <Route path="users" element={<Users />} />
          <Route path="customers" element={<Customers />} />
          <Route path="profile" element={<Profile />} />
          <Route path="role-access" element={<RoleAccess />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
