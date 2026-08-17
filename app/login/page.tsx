"use client"

import { FormEvent, useState } from "react"
import { supabase } from "../../lib/supabaseClient"
import { Button, Card, Notice } from "../components/ui"

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
      "Account created. If email confirmation is enabled, check your inbox before signing in. After you sign in, an admin must approve your account before you can access inventory."
    )
    setLoading(false)
  }

  return (
    <main className="auth-main">
      <Card>
        <h2>{mode === "signin" ? "Sign in" : "Create account"}</h2>
        <p className="subtext auth-lead">
          {mode === "signin"
            ? "Use your email and password to sign in."
            : "Create an account with your work email. An administrator must approve you before you can access inventory."}
        </p>

        {successMessage && <Notice tone="success">{successMessage}</Notice>}
        {errorMessage && <Notice>{errorMessage}</Notice>}

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

          <Button variant="primary" type="submit" disabled={loading}>
            {loading
              ? mode === "signin"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </Button>

          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setMode((prev) => (prev === "signin" ? "signup" : "signin"))
              setErrorMessage("")
              setSuccessMessage("")
              setPassword("")
              setConfirmPassword("")
            }}
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </Button>
        </form>
      </Card>
    </main>
  )
}
