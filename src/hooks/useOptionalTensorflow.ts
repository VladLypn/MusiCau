export interface TensorflowCapability {
  available: boolean;
  load: () => Promise<unknown>;
}

export function useOptionalTensorflow(): TensorflowCapability {
  return {
    available: false,
    load: async () => {
      throw new Error(
        "TensorFlow.js is intentionally not bundled. Add @tensorflow/tfjs when model-backed recognition is ready.",
      );
    },
  };
}
