import { useAuthStore, FORM_CODES } from "@/stores/authStore";

/**
 * Hook for managing role-based access in components and pages.
 */
export function useRoleAccess() {
  const { user, isAdmin, isManager, isSupervisor, isCashier, isWaiter, can } = useAuthStore();

  // 1. High-level Page Access
  const access = {
    canViewAdmin: isAdmin() || isManager(),
    canViewReports: isAdmin() || isManager() || isSupervisor(),
    canViewSettings: isAdmin(),
    canPerformBilling: isAdmin() || isManager() || isSupervisor() || isCashier(),
    canTakeOrder: isAdmin() || isManager() || isSupervisor() || isCashier() || isWaiter(),
    canVoidOrder: isAdmin() || isManager(),   
  };

  // 2. Permission Check by POS Function (e.g. "Discount", "Refund")
  const checkPermission = (functionName: string) => {
    if (isAdmin() || isManager()) return true;
    // You can add more complex logic here if needed
    return false; 
  };

  return {
    user,
    role: user?.role,
    ...access,
    isAdmin: isAdmin(),
    isWaiter: isWaiter(),
    isCashier: isCashier(),
    checkPermission,
    can: (formCode: string) => can(formCode),
  };
}
