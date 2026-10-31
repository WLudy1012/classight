import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/api/client'
import { useAuth } from '@/features/auth/store'

export function useMemberPermissions() {
  const userId = useAuth((state) => state.user?.id)
  return useQuery({
    queryKey: ['member-identity', 'permissions', userId],
    queryFn: () => get<{ permissions: string[] }>('/member-identity/permissions'),
    enabled: !!userId,
    staleTime: 0,
  })
}

export function useMemberPermission(permission: string) {
  const query = useMemberPermissions()
  return { ...query, allowed: query.isSuccess && query.data.permissions.includes(permission) }
}
