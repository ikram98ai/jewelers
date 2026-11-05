import { Center, Loader, Text } from "@mantine/core";
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { EmptyState } from "./components/ui";
import { useAuth } from "./lib/auth";
import { configError } from "./lib/supabase";
import { LoginPage } from "./pages/LoginPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const StockListPage = lazy(() => import("./pages/stock/StockListPage"));
const ReceiveStockPage = lazy(() => import("./pages/stock/ReceiveStockPage"));
const ItemDetailPage = lazy(() => import("./pages/stock/ItemDetailPage"));
const LabelsPage = lazy(() => import("./pages/stock/LabelsPage"));
const ImportPage = lazy(() => import("./pages/stock/ImportPage"));
const StockCheckPage = lazy(() => import("./pages/stock/StockCheckPage"));
const SafekeepingListPage = lazy(() => import("./pages/safekeeping/SafekeepingListPage"));
const SafekeepingNewPage = lazy(() => import("./pages/safekeeping/SafekeepingNewPage"));
const SafekeepingDetailPage = lazy(() => import("./pages/safekeeping/SafekeepingDetailPage"));
const PurchasesListPage = lazy(() => import("./pages/purchases/PurchasesListPage"));
const PurchaseNewPage = lazy(() => import("./pages/purchases/PurchaseNewPage"));
const PurchaseDetailPage = lazy(() => import("./pages/purchases/PurchaseDetailPage"));
const RatesPage = lazy(() => import("./pages/RatesPage"));
const NewSalePage = lazy(() => import("./pages/sales/NewSalePage"));
const SalesListPage = lazy(() => import("./pages/sales/SalesListPage"));
const SaleDetailPage = lazy(() => import("./pages/sales/SaleDetailPage"));
const ClientsPage = lazy(() => import("./pages/clients/ClientsPage"));
const ClientDetailPage = lazy(() => import("./pages/clients/ClientDetailPage"));
const EmployeesPage = lazy(() => import("./pages/employees/EmployeesPage"));
const EmployeeDetailPage = lazy(() => import("./pages/employees/EmployeeDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const AccountPage = lazy(() => import("./pages/AccountPage"));

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  return isAdmin ? <>{children}</> : <EmptyState title="Admins only">Ask the shop admin if you need access.</EmptyState>;
}

const pageFallback = <Center py="xl"><Loader size="sm" /></Center>;

export function App() {
  const { session, profile, loading } = useAuth();

  if (configError) {
    return <Center h="100dvh" p="md"><Text c="red">{configError}</Text></Center>;
  }
  if (loading) {
    return <Center h="100dvh"><Loader color="gold" /></Center>;
  }
  if (!session || !profile) {
    return <LoginPage />;
  }

  return (
    <Suspense fallback={pageFallback}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="stock" element={<StockListPage />} />
          <Route path="stock/new" element={<ReceiveStockPage />} />
          <Route path="stock/labels" element={<LabelsPage />} />
          <Route path="stock/check" element={<StockCheckPage />} />
          <Route path="stock/import" element={<AdminOnly><ImportPage /></AdminOnly>} />
          <Route path="stock/:id" element={<ItemDetailPage />} />
          <Route path="rates" element={<RatesPage />} />
          <Route path="sell" element={<NewSalePage />} />
          <Route path="sales" element={<SalesListPage />} />
          <Route path="sales/:id" element={<SaleDetailPage />} />
          <Route path="safekeeping" element={<SafekeepingListPage />} />
          <Route path="safekeeping/new" element={<SafekeepingNewPage />} />
          <Route path="safekeeping/:id" element={<SafekeepingDetailPage />} />
          <Route path="purchases" element={<AdminOnly><PurchasesListPage /></AdminOnly>} />
          <Route path="purchases/new" element={<AdminOnly><PurchaseNewPage /></AdminOnly>} />
          <Route path="purchases/:id" element={<AdminOnly><PurchaseDetailPage /></AdminOnly>} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientDetailPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />
          <Route path="settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
          <Route path="audit" element={<AdminOnly><AuditPage /></AdminOnly>} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
