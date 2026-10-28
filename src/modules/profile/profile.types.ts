export type ProfileDto = {
  id: number;
  locale: "uk" | "en";
  sex: "male" | "female" | null;
  dateOfBirth: string | null;
  heightCm: number | null;
  targetWeightKg: number | null;
  targetDate: string | null;
  autoAdvanceExercises: boolean;
  createdAt: string;
  updatedAt: string;
};
