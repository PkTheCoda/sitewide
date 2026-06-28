"use client"

import { createContext, useContext, useState, useEffect } from "react"

import { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabaseClient"

type AuthContextType = {
    user: User | null,
    loading: boolean,
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true
})

export function AuthProvider({children}: {children: React.ReactNode}) { 
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function getUser() {
            const {data, error} = await supabase.auth.getUser()

            if (error) {
                console.error(error)
            }

            setUser(data.user)
            setLoading(false)
        }

        getUser()

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user ?? null)
            setLoading(false)
        })

        return () => subscription.unsubscribe()
    }, [])

    return (
        <AuthContext.Provider value={{ user, loading }}>
          {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    return useContext(AuthContext)
}