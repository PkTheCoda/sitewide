import { useAuth } from "@/services/context/authContext"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

// Auth gate. Plain usage only requires a session; `requireOnboarded` (the
// dashboard shell) additionally bounces users who haven't finished onboarding
// to /onboarding. Report pages deliberately DON'T require onboarding — the
// onboarding flow itself ends by deep-linking into the new report.
export default function ProtectedRoute({
    children,
    requireOnboarded = false,
}: {
    children: React.ReactNode
    requireOnboarded?: boolean
}) {
    const { user, loading } = useAuth()
    const router = useRouter()

    const needsOnboarding =
        requireOnboarded && !!user && !user.user_metadata?.onboarding_completed

    useEffect(() => {
        if (loading) return
        if (!user) {
            router.replace('/signin')
        } else if (needsOnboarding) {
            router.replace('/onboarding')
        }
    }, [loading, user, needsOnboarding, router])

    if (loading || !user || needsOnboarding) {
        return null
    }

    return <>{children}</>
}
