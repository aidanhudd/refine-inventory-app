"use client"

import { FormEvent, useState } from "react"
import { supabase } from "../../lib/supabaseClient"

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [successMessage, setSuccessMessage] = useState("")
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMessage("")
    setSuccessMessage("")
    setLoading(true)

    if (mode === "signup" && password !== confirmPassword) {
      setErrorMessage("Passwords do not match.")
      setLoading(false)
      return
    }

    if (mode === "signup" && password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.")
      setLoading(false)
      return
    }

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (error) {
        setErrorMessage(error.message)
        setLoading(false)
        return
      }

      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    })

    if (error) {
      setErrorMessage(error.message)
      setLoading(false)
      return
    }

    setSuccessMessage(
      "Account created. If email confirmation is enabled, check your inbox before signing in."
    )
    setLoading(false)
  }

  return (
    <main style={{ maxWidth: 520 }}>
      <section className="card">
        <h2>{mode === "signin" ? "Sign in" : "Create account"}</h2>
        <p className="subtext" style={{ marginBottom: "16px" }}>
          {mode === "signin"
            ? "Use your Supabase Auth email and password to access inventory."
            : "Create a Supabase Auth account to get access to inventory."}
        </p>

        {successMessage && <div className="success">{successMessage}</div>}
        {errorMessage && <div className="notice">{errorMessage}</div>}

        <form className="form-grid" onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Password</label>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {mode === "signup" && (
            <div className="field">
              <label>Confirm Password</label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading
              ? mode === "signin"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signin"
              ? "Sign in"
              : "Create account"}
          </button>

          <button
            className="btn-secondary"
            type="button"
            onClick={() => {
              setMode((prev) => (prev === "signin" ? "signup" : "signin"))
              setErrorMessage("")
              setSuccessMessage("")
              setPassword("")
              setConfirmPassword("")
            }}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </form>
      </section>
    </main>
  )
}
