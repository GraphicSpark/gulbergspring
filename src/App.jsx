import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'

// Route pages are code-split so heavy deps (recharts on the Dashboard) stay out
// of the initial bundle.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Users = lazy(() => import('./pages/Users'))
const Customers = lazy(() => import('./pages/Customers'))
const Clients = lazy(() => import('./pages/Clients'))
const Packages = lazy(() => import('./pages/Packages'))
const Orders = lazy(() => import('./pages/Orders'))
const Accounts = lazy(() => import('./pages/Accounts'))
const FinancialLedger = lazy(() => import('./pages/FinancialLedger'))
const AccountLedger = lazy(() => import('./pages/AccountLedger'))
const AgentLedger = lazy(() => import('./pages/AgentLedger'))
const ClientLedger = lazy(() => import('./pages/ClientLedger'))
const PackagePerformance = lazy(() => import('./pages/PackagePerformance'))
const AgentPerformance = lazy(() => import('./pages/AgentPerformance'))
const Reports = lazy(() => import('./pages/Reports'))
const Settlements = lazy(() => import('./pages/Settlements'))
const RoleAccess = lazy(() => import('./pages/RoleAccess'))
const Profile = lazy(() => import('./pages/Profile'))

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<Clients />} />
          <Route path="packages" element={<Packages />} />
          <Route path="customers" element={<Customers />} />
          <Route path="orders" element={<Orders />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="financial-ledger" element={<FinancialLedger />} />
          <Route path="account-ledger" element={<AccountLedger />} />
          <Route path="agent-ledger" element={<AgentLedger />} />
          <Route path="client-ledger" element={<ClientLedger />} />
          <Route path="package-performance" element={<PackagePerformance />} />
          <Route path="agent-performance" element={<AgentPerformance />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settlements" element={<Settlements />} />
          <Route path="users" element={<Users />} />
          <Route path="profile" element={<Profile />} />
          <Route path="role-access" element={<RoleAccess />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
