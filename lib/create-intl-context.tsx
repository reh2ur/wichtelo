"use client";

import { NextIntlClientProvider, useTranslations } from "next-intl";
import type {
  AppConfig,
  AbstractIntlMessages,
  NamespaceKeys,
  NestedKeyOf,
} from "next-intl";

type Messages = AppConfig["Messages"];

type NestedPick<
  T,
  Path extends string,
> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? { [K in Head]: NestedPick<T[Head], Tail> }
    : never
  : Path extends keyof T
    ? { [K in Path]: T[K] }
    : never;

export function createIntlContext<
  const NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>>,
>(namespace: NestedKey) {
  function Provider({
    messages,
    children,
  }: {
    messages: NestedPick<Messages, NestedKey>;
    children: React.ReactNode;
  }) {
    return (
      <NextIntlClientProvider
        messages={messages as AbstractIntlMessages}
        locale="de"
      >
        {children}
      </NextIntlClientProvider>
    );
  }

  function useT() {
    return useTranslations(namespace);
  }

  return { Provider, useT };
}
