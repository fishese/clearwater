export async function changeLanguage(page,language){
 await page.locator('.settings-launch:visible').first().click();
 const choices=await page.locator('.settings-page .language-select option').allTextContents();
 await page.locator('.settings-page .language-select').selectOption(language);
 await page.locator('.settings-close').click();
 return choices;
}
export async function readLanguage(page){
 await page.locator('.settings-launch:visible').first().click();
 const language=await page.locator('.settings-page .language-select').inputValue();
 await page.locator('.settings-close').click();return language;
}
