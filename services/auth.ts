import { supabase } from "@/lib/supabaseClient";

export interface NewUserData {
    email: string,
    password: string,
    username?: string
}

export async function createNewUser({email, password, username}: NewUserData) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
    })
    console.log(data)
    console.log(error)
    return { data, error };
}

export async function signInWithEmail({email, password}: NewUserData) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error };
}