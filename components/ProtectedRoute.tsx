import { useAuth } from "@/services/context/authContext"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth()
    const router = useRouter()

    useEffect(() => {
        if (!loading && !user) {
            router.replace('/signin')
        }
    }, [loading, user, router])

    if (loading || !user) {
        return null
    }

    return <>{children}</>
}