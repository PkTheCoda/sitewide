"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/services/context/authContext";
import { signOut, updateDisplayName, updateEmail, updatePassword } from "@/services/auth";
import { LuLoaderCircle, LuLogOut } from "react-icons/lu";

type Status = { type: "success" | "error"; message: string } | null;

// Basic account settings: edit display name / email / password, and sign out.
export default function SettingsSection() {
    const { user } = useAuth();
    const router = useRouter();

    const currentName =
        user?.user_metadata?.full_name ??
        user?.user_metadata?.username ??
        user?.user_metadata?.name ??
        "";

    const [name, setName] = useState<string>(currentName);
    const [email, setEmail] = useState<string>(user?.email ?? "");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [profileStatus, setProfileStatus] = useState<Status>(null);
    const [passwordStatus, setPasswordStatus] = useState<Status>(null);

    const [savingProfile, setSavingProfile] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

    async function handleSaveProfile() {
        if (savingProfile) return;
        setProfileStatus(null);

        const trimmedName = name.trim();
        const trimmedEmail = email.trim();

        if (!trimmedName) {
            setProfileStatus({ type: "error", message: "Display name can't be empty." });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            setProfileStatus({ type: "error", message: "Enter a valid email address." });
            return;
        }

        setSavingProfile(true);

        const nameChanged = trimmedName !== currentName;
        const emailChanged = trimmedEmail !== (user?.email ?? "");

        if (nameChanged) {
            const { error } = await updateDisplayName(trimmedName);
            if (error) {
                setSavingProfile(false);
                setProfileStatus({ type: "error", message: "Couldn't update your name. Please try again." });
                return;
            }
        }

        if (emailChanged) {
            const { error } = await updateEmail(trimmedEmail);
            setSavingProfile(false);
            if (error) {
                setProfileStatus({ type: "error", message: "Couldn't update your email. Please try again." });
                return;
            }
            setProfileStatus({
                type: "success",
                message: "Saved. Check your new inbox for a confirmation link before the email change takes effect.",
            });
            return;
        }

        setSavingProfile(false);
        setProfileStatus(
            nameChanged
                ? { type: "success", message: "Profile updated." }
                : { type: "success", message: "Nothing to save — no changes made." }
        );
    }

    async function handleChangePassword() {
        if (savingPassword) return;
        setPasswordStatus(null);

        if (password.length < 6) {
            setPasswordStatus({ type: "error", message: "Password must be at least 6 characters." });
            return;
        }
        if (password !== confirmPassword) {
            setPasswordStatus({ type: "error", message: "Passwords don't match." });
            return;
        }

        setSavingPassword(true);
        const { error } = await updatePassword(password);
        setSavingPassword(false);

        if (error) {
            setPasswordStatus({ type: "error", message: "Couldn't update your password. Please try again." });
            return;
        }

        setPassword("");
        setConfirmPassword("");
        setPasswordStatus({ type: "success", message: "Password updated." });
    }

    async function handleSignOut() {
        if (signingOut) return;
        setSigningOut(true);
        await signOut();
        router.replace("/signin");
    }

    return (
        <div className="flex flex-col gap-6 max-w-2xl">
            <div>
                <h2 className="text-lg font-medium tracking-tight text-stone-800">Settings</h2>
                <p className="text-sm text-stone-500">Manage your account details.</p>
            </div>

            {/* Profile */}
            <div className="flex flex-col gap-4 bg-stone-50 border border-stone-200 rounded-xl p-6 shadow-xs">
                <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">Profile</p>

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-stone-800">Display name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full text-sm text-stone-800 bg-white border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-stone-800">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="w-full text-sm text-stone-800 bg-white border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                    />
                    <p className="text-xs text-stone-400">
                        Changing your email sends a confirmation link to the new address.
                    </p>
                </div>

                {profileStatus && (
                    <p className={`text-xs ${profileStatus.type === "error" ? "text-red-600" : "text-green-600"}`}>
                        {profileStatus.message}
                    </p>
                )}

                <button
                    onClick={handleSaveProfile}
                    disabled={savingProfile}
                    className="self-start flex items-center gap-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl px-6 py-2.5 transition-colors"
                >
                    {savingProfile && <LuLoaderCircle className="size-4 animate-spin" />}
                    {savingProfile ? "Saving…" : "Save changes"}
                </button>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-4 bg-stone-50 border border-stone-200 rounded-xl p-6 shadow-xs">
                <p className="text-[11px] font-medium tracking-wider text-stone-400 uppercase">Password</p>

                <div className="flex gap-4">
                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-sm font-medium text-stone-800">New password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full text-sm text-stone-800 bg-white border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1">
                        <label className="text-sm font-medium text-stone-800">Confirm password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full text-sm text-stone-800 bg-white border border-stone-200 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-600 placeholder:text-stone-400"
                        />
                    </div>
                </div>

                {passwordStatus && (
                    <p className={`text-xs ${passwordStatus.type === "error" ? "text-red-600" : "text-green-600"}`}>
                        {passwordStatus.message}
                    </p>
                )}

                <button
                    onClick={handleChangePassword}
                    disabled={savingPassword || !password}
                    className="self-start flex items-center gap-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-xl px-6 py-2.5 transition-colors"
                >
                    {savingPassword && <LuLoaderCircle className="size-4 animate-spin" />}
                    {savingPassword ? "Updating…" : "Update password"}
                </button>
            </div>

            {/* Account */}
            <div className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded-xl p-6 shadow-xs">
                <div>
                    <p className="text-sm font-medium text-stone-800">Log out</p>
                    <p className="text-xs text-stone-500">Sign out of your account on this device.</p>
                </div>
                <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex items-center gap-2 text-sm font-medium text-red-600 bg-white border border-red-200 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl px-5 py-2.5 transition-colors"
                >
                    {signingOut ? (
                        <LuLoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <LuLogOut className="size-4" />
                    )}
                    {signingOut ? "Signing out…" : "Log out"}
                </button>
            </div>
        </div>
    );
}
