"use server";

import { ID } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite";
import { cookies } from "next/headers";
import { encryptId, extractCustomerIdFromUrl, parseStringify } from "../utils";
import {
  CountryCode,
  ProcessorTokenCreateRequest,
  ProcessorTokenCreateRequestProcessorEnum,
  Products,
} from "plaid";
import { plaidclient } from "../plaid";
import { create } from "domain";
import { revalidatePath } from "next/cache";
import { addFundingSource, createDwollaCustomer } from "./dwolla.action";

const {
  APPWRITE_DATABASE_ID: DATABASE_ID,
  APPWRITE_USER_COLLECTION_ID: USER_COLLECTION_ID,
  APPWRITE_BANK_COLLECTION_ID: BANK_COLLECTION_ID,
} = process.env;

export const signIn = async ({ email, password }: signInProps) => {
  try {
    const { account } = await createAdminClient();
    const response = await account.createEmailPasswordSession(email, password);
    // console.log("Sign-in rsps", response);
    cookies().set({
      name: "appwrite-session",
      value: response.secret,
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });
    return parseStringify(response);
  } catch (error) {
    console.error(error);
  }
};

export const signUp = async ({password,...userData}: SignUpParams) => {
  const { email, firstName,  lastName } = userData;
  let newUserAccount;
  try {
    // create a user account
    const { account,database } = await createAdminClient();

     newUserAccount = await account.create(
      ID.unique(),
      email,
      password,
      `${firstName} ${lastName}`
    );

    if(!newUserAccount) throw new Error("ERROR to create user")
    
    const dwollaCustomerUrl = await createDwollaCustomer({
      ...userData,
      type:'personal',
    })
    console.log("Dwolla customer url ",dwollaCustomerUrl)

    if(!dwollaCustomerUrl) throw new Error("Error creating Dwolla customer")

    const dwollaCustomerId = extractCustomerIdFromUrl(dwollaCustomerUrl)

    const newUser = await database.createDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      ID.unique(),
      {
        ...userData,
        userId: newUserAccount.$id,
        dwollaCustomerId,
        dwollaCustomerUrl
      }
    )

    const session = await account.createEmailPasswordSession(email, password);

    cookies().set({
      name: "appwrite-session",
      value: session.secret,
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });

    console.log(cookies().has("appwrite-session"));
    // console.log(newUserAccount);
    return parseStringify(newUser);
  } catch (error) {
    console.error(error);
  }
};

export async function getLoggedInUser() {
  try {
    const { account } = await createSessionClient();
    const user = await account.get();
    // console.log("Get logged in client", user);
    return parseStringify(user);
  } catch (error) {
    // console.error(error);
    return null;
  }
}

export const logout = async () => {
  try {
    const { account } = await createSessionClient();

    cookies().delete("appwrite-session");

    await account.deleteSession("current");
  } catch (error) {
    console.error(error);
    return null;
  }
};

export const createLinkToken = async (user: User) => {
  try {
    const tokenParams = {
      user: {
        client_user_id: user.$id,
      },
      client_name: `${user.firstName} ${user.lastName}`,
      products: ["auth"] as Products[],
      language: "en",
      country_codes: ["US"] as CountryCode[],
    };
    const response = await plaidclient.linkTokenCreate(tokenParams);
    console.log(response);

    return parseStringify({ linkToken: response.data.link_token });
  } catch (error) {
    console.error(error);
  }
};

export const createBankAccount = async ({
  userId,
  bankId,
  accountId,
  accessToken,
  fundingSourceUrl,
  sharableId,
}: createBankAccountProps) => {
  try {
    const { database } = await createAdminClient();
    const bankAccount = await database.createDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      ID.unique(),
      {
        userId,
        bankId,
        accountId,
        accessToken,
        fundingSourceUrl,
        sharableId,
      }
    );

    return parseStringify(bankAccount)
  } catch (error) {}
};

export const exchangePublicToken = async ({
  publicToken,
  user,
}: exchangePublicTokenProps) => {
  try {
    // Exchange public token for access token  and items ID
    const response = await plaidclient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Get account information from Plaid using access token

    const accountResponse = await plaidclient.accountsGet({
      access_token: accessToken,
    });

    const accountData = accountResponse.data.accounts[0];

    // Create a process token for dwolla using the access token and accountId

    const request: ProcessorTokenCreateRequest = {
      access_token: accessToken,
      account_id: accountData.account_id,
      processor: "dwolla" as ProcessorTokenCreateRequestProcessorEnum,
    };

    const processorTokenRequest = await plaidclient.processorTokenCreate(
      request
    );
    const processorToken = processorTokenRequest.data.processor_token;

    // Create a funding source URL for account using the Dwolla customer ID , processorToken, and bank name
    const fundingSourceUrl = await addFundingSource({
      dwollaCustomerId: user.dwollaCustomerId,
      processorToken,
      bankName: accountData.name,
    });

    // If funding source URL is not created, throw an error

    if (!fundingSourceUrl) throw Error;

    // Creating a bank account using user ID , Item Id, account Id, access Token , funding source URL and shareable id,

    await createBankAccount({
      userId: user.$id,
      bankId: itemId,
      accountId: accountData.account_id,
      accessToken,
      fundingSourceUrl,
      sharableId: encryptId(accountData.account_id),
    });

    // Revalidate the path to reflect the changes
    revalidatePath("/");

    // Return a success message
    return parseStringify({
      publicTokenExchange: "complete",
    });
  } catch (error) {
    console.error("An error occurred while creating exchange token:", error);
  }
};
