/**
 * Type declarations for react-native-external-display
 *
 * The library ships with an incomplete `index.d.ts` that references
 * `ExternalDisplayOptions` without declaring it, causing TypeScript compile
 * errors. This module declaration overrides the broken shipped types with a
 * complete, correct set of types matching the actual JS implementation.
 */
declare module "react-native-external-display" {
  import { Component, ReactNode } from "react";
  import { StyleProp, ViewStyle, ViewProps } from "react-native";

  /** Metadata for a connected secondary display as returned by DisplayManager. */
  export type Screen = {
    width: number;
    height: number;
  };

  export type ExternalDisplayOptions = {
    onScreenConnect?: (screens: Record<string, Screen>) => void;
    onScreenChange?: (screens: Record<string, Screen>) => void;
    onScreenDisconnect?: (screens: Record<string, Screen>) => void;
  };

  /**
   * Returns a map of { [displayId]: Screen } for all currently connected
   * secondary displays. Re-renders whenever a display is connected or
   * disconnected, enabling hot-reconnect without an app restart.
   */
  export function useExternalDisplay(
    options?: ExternalDisplayOptions
  ): Record<string, Screen>;

  /** Returns the same map as useExternalDisplay() synchronously. */
  export function getScreens(): Record<string, Screen>;

  export type ExternalDisplayProps = {
    /** The display ID from useExternalDisplay() to project content onto. */
    screen?: string;
    /** If true, renders children on the main screen when no external display is connected. */
    fallbackInMainScreen?: boolean;
    mainScreenStyle?: StyleProp<ViewStyle>;
    style?: StyleProp<ViewStyle>;
    children?: ReactNode;
    onScreenConnect?: (screens: Record<string, Screen>) => void;
    onScreenChange?: (screens: Record<string, Screen>) => void;
    onScreenDisconnect?: (screens: Record<string, Screen>) => void;
  } & ViewProps;

  /** Projects children onto the specified secondary display via Android Presentation API. */
  export default class ExternalDisplay extends Component<ExternalDisplayProps> {}
}
