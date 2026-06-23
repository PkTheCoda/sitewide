import { supabase } from "@/lib/supabaseClient";

export interface NewUserData {
    email: string,
    password: string,
    username?: string
}

export async function createNewUser({email, password, username}: NewUserData) {
    const {data, error} = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: {
                username: username
            }
        }
    })

    console.log(error)
    console.log(data)
}