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

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    return { error };
}

// Writes both keys since signup stores `username` but the dashboard shell
// displays `full_name`/`name` (set by OAuth providers).
export async function updateDisplayName(name: string) {
    const { data, error } = await supabase.auth.updateUser({
        data: { username: name, full_name: name },
    });
    return { data, error };
}

// Supabase sends a confirmation link to the new address before it takes effect.
export async function updateEmail(email: string) {
    const { data, error } = await supabase.auth.updateUser({ email });
    return { data, error };
}

export async function updatePassword(password: string) {
    const { data, error } = await supabase.auth.updateUser({ password });
    return { data, error };
}