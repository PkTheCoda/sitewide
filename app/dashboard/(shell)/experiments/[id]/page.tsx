"use client"

import { useParams } from "next/navigation"

export default function IndividualExperimentPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div>Experiment ID: {id}</div>
  )
}