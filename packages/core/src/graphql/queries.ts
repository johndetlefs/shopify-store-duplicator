/**
 * GraphQL query and mutation strings for Shopify Admin API.
 * Version: 2025-10
 */

/**
 * Bulk Operations
 */
export const BULK_OPERATION_RUN_QUERY = `
  mutation bulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
        url
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const CURRENT_BULK_OPERATION = `
  query {
    currentBulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
`;

/**
 * Metaobject Definitions
 */
export const METAOBJECT_DEFINITIONS_QUERY = `
  query metaobjectDefinitions($first: Int!, $after: String) {
    metaobjectDefinitions(first: $first, after: $after) {
      edges {
        node {
          id
          name
          type
          description
          displayNameKey
          fieldDefinitions {
            key
            name
            description
            required
            type {
              name
            }
            validations {
              name
              value
            }
          }
          capabilities {
            publishable {
              enabled
            }
            translatable {
              enabled
            }
            renderable {
              enabled
              data {
                metaTitleKey
                metaDescriptionKey
              }
            }
            onlineStore {
              enabled
              data {
                urlHandle
                canCreateRedirects
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAOBJECT_DEFINITION_CREATE = `
  mutation metaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAOBJECT_DEFINITION_UPDATE = `
  mutation metaobjectDefinitionUpdate($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
    metaobjectDefinitionUpdate(id: $id, definition: $definition) {
      metaobjectDefinition {
        id
        name
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Metafield Definitions
 */
export const METAFIELD_DEFINITIONS_QUERY = `
  query metafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
    metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
      edges {
        node {
          id
          name
          namespace
          key
          description
          type {
            name
          }
          ownerType
          validations {
            name
            value
          }
          pinnedPosition
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAFIELD_DEFINITION_CREATE = `
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        name
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const METAFIELD_DEFINITION_UPDATE = `
  mutation metafieldDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition {
        id
        name
        namespace
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Metaobjects (Data/Entries)
 */
export const METAOBJECTS_BY_TYPE_BULK = (type: string) => `
  {
    metaobjects(type: "${type}") {
      edges {
        node {
          id
          handle
          type
          displayName
          updatedAt
          fields {
            key
            type
            value
            reference {
              __typename
              ... on Metaobject {
                id
                type
                handle
              }
              ... on Product {
                id
                handle
              }
              ... on ProductVariant {
                id
                sku
                product {
                  handle
                }
              }
              ... on Collection {
                id
                handle
              }
              ... on Page {
                id
                handle
              }
              ... on MediaImage {
                id
                image {
                  url
                }
              }
              ... on Video {
                id
                sources {
                  url
                }
              }
              ... on GenericFile {
                id
                url
              }
            }
          }
        }
      }
    }
  }
`;

export const METAOBJECT_UPSERT = `
  mutation metaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Products with Metafields
 */
export const PRODUCTS_BULK = `
  {
    products {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          status
          vendor
          productType
          tags
          options {
            id
            name
            position
            values
          }
          media(first: 250) {
            edges {
              node {
                ... on MediaImage {
                  id
                  alt
                  image {
                    url
                  }
                }
                ... on Video {
                  id
                  alt
                  sources {
                    url
                  }
                }
              }
            }
          }
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on Collection {
                    id
                    handle
                  }
                }
              }
            }
          }
          variants(first: 250) {
            edges {
              node {
                id
                sku
                title
                position
                price
                compareAtPrice
                barcode
                inventoryQuantity
                inventoryPolicy
                taxable
                selectedOptions {
                  name
                  value
                }
                inventoryItem {
                  id
                  tracked
                  measurement {
                    weight {
                      value
                      unit
                    }
                  }
                }
                metafields(first: 250) {
                  edges {
                    node {
                      id
                      namespace
                      key
                      value
                      type
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Collections with Metafields
 */
export const COLLECTIONS_BULK = `
  {
    collections {
      edges {
        node {
          id
          handle
          title
          descriptionHtml
          ruleSet {
            appliedDisjunctively
            rules {
              column
              relation
              condition
            }
          }
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Metafields Set (Batch Upsert)
 */
export const METAFIELDS_SET = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
        ownerType
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Files
 */
export const STAGED_UPLOADS_CREATE = `
  mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const FILE_CREATE = `
  mutation fileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        alt
        createdAt
        ... on MediaImage {
          image {
            url
          }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const FILE_UPDATE = `
  mutation fileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
        alt
        ... on MediaImage {
          image {
            url
          }
        }
        ... on GenericFile {
          url
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const FILES_QUERY = `
  query files($first: Int!, $after: String) {
    files(first: $first, after: $after) {
      edges {
        node {
          ... on MediaImage {
            id
            alt
            fileStatus
            image {
              url
            }
          }
          ... on Video {
            id
            alt
            fileStatus
            sources {
              url
            }
          }
          ... on GenericFile {
            id
            alt
            fileStatus
            url
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const FILES_BULK = `
  {
    files {
      edges {
        node {
          ... on MediaImage {
            id
            alt
            createdAt
            fileStatus
            image {
              url
            }
          }
          ... on Video {
            id
            alt
            createdAt
            fileStatus
            sources {
              url
            }
          }
          ... on GenericFile {
            id
            alt
            createdAt
            fileStatus
            url
            mimeType
          }
        }
      }
    }
  }
`;

/**
 * Pages
 */
export const PAGES_BULK = `
  {
    pages {
      edges {
        node {
          id
          handle
          title
          body
          bodySummary
          templateSuffix
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Shop (for shop-level metafields)
 */
export const SHOP_BULK = `
  {
    shop {
      id
      name
      metafields(first: 250) {
        edges {
          node {
            id
            namespace
            key
            value
            type
            reference {
              __typename
              ... on Metaobject {
                id
                type
                handle
              }
              ... on Product {
                id
                handle
              }
              ... on Collection {
                id
                handle
              }
              ... on Page {
                id
                handle
              }
            }
            references(first: 250) {
              edges {
                node {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on Collection {
                    id
                    handle
                  }
                  ... on Page {
                    id
                    handle
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const PAGE_CREATE = `
  mutation pageCreate($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        handle
        title
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const PAGE_UPDATE = `
  mutation pageUpdate($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        handle
        title
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Blogs and Articles
 */
export const BLOGS_BULK = `
  {
    blogs {
      edges {
        node {
          id
          handle
          title
          templateSuffix
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on Collection {
                    id
                    handle
                  }
                }
                references(first: 250) {
                  edges {
                    node {
                      __typename
                      ... on Metaobject {
                    id
                        type
                        handle
                      }
                      ... on Product {
                    id
                        handle
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const ARTICLES_BULK = `
  {
    articles {
      edges {
        node {
          id
          handle
          title
          body
          templateSuffix
          image {
            altText
            url
          }
          blog {
            handle
          }
          metafields(first: 250) {
            edges {
              node {
                id
                namespace
                key
                value
                type
                reference {
                  __typename
                  ... on Metaobject {
                    id
                    type
                    handle
                  }
                  ... on Product {
                    id
                    handle
                  }
                  ... on Collection {
                    id
                    handle
                  }
                }
                references(first: 250) {
                  edges {
                    node {
                      __typename
                      ... on Metaobject {
                    id
                        type
                        handle
                      }
                      ... on Product {
                    id
                        handle
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const BLOG_CREATE = `
  mutation blogCreate($blog: BlogCreateInput!) {
    blogCreate(blog: $blog) {
      blog {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const BLOG_UPDATE = `
  mutation blogUpdate($id: ID!, $blog: BlogUpdateInput!) {
    blogUpdate(id: $id, blog: $blog) {
      blog {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ARTICLE_CREATE = `
  mutation articleCreate($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ARTICLE_UPDATE = `
  mutation articleUpdate($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Menus
 */
export const MENUS_QUERY = `
  query menus($first: Int!) {
    menus(first: $first) {
      edges {
        node {
          id
          handle
          title
          items {
            id
            title
            url
            type
            items {
              id
              title
              url
              type
              items {
                id
                title
                url
                type
              }
            }
          }
        }
      }
    }
  }
`;

export const MENU_CREATE = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MENU_UPDATE = `
  mutation menuUpdate($id: ID!, $title: String!, $handle: String, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
      menu {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const MENU_DELETE = `
  mutation menuDelete($id: ID!) {
    menuDelete(id: $id) {
      deletedMenuId
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Redirects
 */
export const REDIRECTS_BULK = `
  {
    urlRedirects {
      edges {
        node {
          id
          path
          target
        }
      }
    }
  }
`;

export const REDIRECT_CREATE = `
  mutation urlRedirectCreate($urlRedirect: UrlRedirectInput!) {
    urlRedirectCreate(urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const REDIRECT_UPDATE = `
  mutation urlRedirectUpdate($id: ID!, $urlRedirect: UrlRedirectInput!) {
    urlRedirectUpdate(id: $id, urlRedirect: $urlRedirect) {
      urlRedirect {
        id
        path
        target
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Product/Collection/Page lookups for mapping
 */
export const PRODUCTS_HANDLES_QUERY = `
  query products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCTS_WITH_VARIANTS_QUERY = `
  query productsWithVariants($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          handle
          variants(first: 100) {
            edges {
              node {
                id
                sku
                position
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const COLLECTIONS_HANDLES_QUERY = `
  query collections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PAGES_HANDLES_QUERY = `
  query pages($first: Int!, $after: String) {
    pages(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const BLOGS_HANDLES_QUERY = `
  query blogs($first: Int!, $after: String) {
    blogs(first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const ARTICLES_HANDLES_QUERY = `
  query articles($first: Int!, $after: String) {
    articles(first: $first, after: $after) {
      edges {
        node {
          id
          handle
          blog {
            handle
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const METAOBJECTS_HANDLES_QUERY = `
  query metaobjects($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      edges {
        node {
          id
          type
          handle
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const PRODUCT_CREATE = `
  mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_UPDATE = `
  mutation productUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_CREATE_MEDIA = `
  mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
        mediaContentType
      }
      mediaUserErrors {
        field
        message
      }
      product {
        id
      }
    }
  }
`;

export const PRODUCT_VARIANT_BULK_CREATE = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        sku
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PRODUCT_VARIANT_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        sku
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_CREATE = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const COLLECTION_UPDATE = `
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Resolve GIDs to handles for list-type metafield references
 */
export const RESOLVE_NODES_QUERY = `
  query resolveNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
      }
      ... on Collection {
        id
        handle
      }
      ... on Metaobject {
        id
        type
        handle
      }
      ... on Page {
        id
        handle
      }
      ... on Blog {
        id
        handle
      }
      ... on Article {
        id
        handle
        blog {
          handle
        }
      }
    }
  }
`;

/**
 * Shop Policies
 */
export const SHOP_INFO_QUERY = `
  query {
    shop {
      id
      myshopifyDomain
      url
      customerAccountsV2 {
        url
      }
    }
  }
`;

export const SHOP_POLICIES_QUERY = `
  query {
    shop {
      shopPolicies {
        type
        body
        url
      }
    }
  }
`;

export type ShopPolicyType =
  | "REFUND_POLICY"
  | "PRIVACY_POLICY"
  | "TERMS_OF_SERVICE"
  | "SHIPPING_POLICY";

export const SHOP_POLICY_UPDATE = `
  mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
    shopPolicyUpdate(shopPolicy: $shopPolicy) {
      shopPolicy {
        type
        body
        url
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Publications (Sales Channels)
 */
export const PUBLICATIONS_QUERY = `
  query publications($first: Int!, $after: String) {
    publications(first: $first, after: $after) {
      edges {
        node {
          id
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Query to fetch publications for a specific product
 */
export const PRODUCT_PUBLICATIONS_QUERY = `
  query productPublications($id: ID!) {
    product(id: $id) {
      id
      resourcePublications(first: 25) {
        edges {
          node {
            publication {
              id
              name
            }
            publishDate
            isPublished
          }
        }
      }
    }
  }
`;

/**
 * Query to fetch publications for a specific collection
 */
export const COLLECTION_PUBLICATIONS_QUERY = `
  query collectionPublications($id: ID!) {
    collection(id: $id) {
      id
      resourcePublications(first: 25) {
        edges {
          node {
            publication {
              id
              name
            }
            publishDate
            isPublished
          }
        }
      }
    }
  }
`;

export const PUBLISHABLE_PUBLISH = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          id
        }
        ... on Collection {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const PUBLISHABLE_UNPUBLISH = `
  mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
    publishableUnpublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          id
        }
        ... on Collection {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Discounts - Bulk Query
 * Fetches both automatic and code discounts with all configuration details
 */

// Split: Code Discounts Bulk Query (≤5 connections)
export const DISCOUNTS_CODE_BULK = `
{
  codeDiscountNodes(first: 250) {
    edges {
      node {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title status summary startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            recurringCycleLimit
            codes(first: 250) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
            }
          }
          ... on DiscountCodeBxgy {
            title status summary startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            usesPerOrderLimit
            codes(first: 250) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
            }
          }
          ... on DiscountCodeFreeShipping {
            title status summary startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            recurringCycleLimit appliesOnOneTimePurchase appliesOnSubscription
            maximumShippingPrice { amount currencyCode }
            codes(first: 250) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            destinationSelection {
              __typename
              ... on DiscountCountries {
                countries includeRestOfWorld
              }
              ... on DiscountCountryAll {
                allCountries
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split query for DiscountCodeBasic with full product/collection details
export const DISCOUNTS_CODE_BASIC_BULK = `
{
  codeDiscountNodes(first: 250) {
    edges {
      node {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title status summary startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            recurringCycleLimit
            codes(first: 250) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { edges { node { id handle } } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { edges { node { id handle } } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split query for DiscountCodeBxgy (limited to 5 connections - can't query both customerBuys AND customerGets items with products/collections)
// Connection count: codeDiscountNodes(1) + codes(2) + customerGets.products(3) + customerGets.collections(4) = 4 connections
export const DISCOUNTS_CODE_BXGY_BULK = `
{
  codeDiscountNodes(first: 250) {
    edges {
      node {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBxgy {
            title status summary startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            usesPerOrderLimit
            codes(first: 250) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            customerBuys {
              items {
                __typename
                ... on AllDiscountItems { allItems }
              }
              value {
                __typename
                ... on DiscountQuantity { quantity }
                ... on DiscountPurchaseAmount { amount }
              }
            }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
                ... on DiscountOnQuantity {
                  quantity { quantity }
                  effect {
                    __typename
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
                  }
                }
              }
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { edges { node { id handle } } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { edges { node { id handle } } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// Complementary query for DiscountCodeBxgy to capture customerBuys items (products/collections)
// This query captures what the customer BUYS (triggers), while the main query captures what they GET
// Connection count: codeDiscountNodes(1) + codes(2) + customerBuys.products(3) + customerBuys.collections(4) = 4 connections
export const DISCOUNTS_CODE_BXGY_BUYS_BULK = `
{
  codeDiscountNodes(first: 250) {
    edges {
      node {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeBxgy {
            title
            customerBuys {
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { edges { node { id handle } } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { edges { node { id handle } } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split query for DiscountCodeFreeShipping (no products/collections needed)
export const DISCOUNTS_CODE_FREE_SHIPPING_BULK = `
{
  codeDiscountNodes(first: 250) {
    edges {
      node {
        id
        codeDiscount {
          __typename
          ... on DiscountCodeFreeShipping {
            title status summary startsAt endsAt usageLimit appliesOncePerCustomer asyncUsageCount
            recurringCycleLimit appliesOnOneTimePurchase appliesOnSubscription
            maximumShippingPrice { amount currencyCode }
            codes(first: 250) { edges { node { code } } }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            destinationSelection {
              __typename
              ... on DiscountCountries {
                countries includeRestOfWorld
              }
              ... on DiscountCountryAll {
                allCountries
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split: Automatic Discounts Bulk Query (≤5 connections)
export const DISCOUNTS_AUTOMATIC_BULK = `
{
  automaticDiscountNodes(first: 250) {
    edges {
      node {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBasic {
            title status summary startsAt endsAt
            recurringCycleLimit
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
            }
          }
          ... on DiscountAutomaticBxgy {
            title status summary startsAt endsAt
            usesPerOrderLimit
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
            }
          }
          ... on DiscountAutomaticFreeShipping {
            title status summary startsAt endsAt
            recurringCycleLimit appliesOnOneTimePurchase appliesOnSubscription
            maximumShippingPrice { amount currencyCode }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            destinationSelection {
              __typename
              ... on DiscountCountries {
                countries includeRestOfWorld
              }
              ... on DiscountCountryAll {
                allCountries
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split query for DiscountAutomaticBasic with full product/collection details
export const DISCOUNTS_AUTOMATIC_BASIC_BULK = `
{
  automaticDiscountNodes(first: 250) {
    edges {
      node {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBasic {
            title status summary startsAt endsAt
            recurringCycleLimit
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
              }
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { edges { node { id handle } } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { edges { node { id handle } } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split query for DiscountAutomaticBxgy (limited to 5 connections - can't query both customerBuys AND customerGets items with products/collections)
// Connection count: automaticDiscountNodes(1) + customerGets.products(2) + customerGets.collections(3) = 3 connections
export const DISCOUNTS_AUTOMATIC_BXGY_BULK = `
{
  automaticDiscountNodes(first: 250) {
    edges {
      node {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBxgy {
            title status summary startsAt endsAt
            usesPerOrderLimit
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            customerBuys {
              items {
                __typename
                ... on AllDiscountItems { allItems }
              }
              value {
                __typename
                ... on DiscountQuantity { quantity }
                ... on DiscountPurchaseAmount { amount }
              }
            }
            customerGets {
              appliesOnOneTimePurchase appliesOnSubscription
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
                ... on DiscountOnQuantity {
                  quantity { quantity }
                  effect {
                    __typename
                    ... on DiscountPercentage { percentage }
                    ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
                  }
                }
              }
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { edges { node { id handle } } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { edges { node { id handle } } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// Complementary query for DiscountAutomaticBxgy to capture customerBuys items (products/collections)
// This query captures what the customer BUYS (triggers), while the main query captures what they GET
// Connection count: automaticDiscountNodes(1) + customerBuys.products(2) + customerBuys.collections(3) = 3 connections
export const DISCOUNTS_AUTOMATIC_BXGY_BUYS_BULK = `
{
  automaticDiscountNodes(first: 250) {
    edges {
      node {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBxgy {
            title
            customerBuys {
              items {
                __typename
                ... on AllDiscountItems { allItems }
                ... on DiscountProducts {
                  products(first: 250) { edges { node { id handle } } }
                }
                ... on DiscountCollections {
                  collections(first: 250) { edges { node { id handle } } }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// Split query for DiscountAutomaticFreeShipping (no products/collections needed)
export const DISCOUNTS_AUTOMATIC_FREE_SHIPPING_BULK = `
{
  automaticDiscountNodes(first: 250) {
    edges {
      node {
        id
        automaticDiscount {
          __typename
          ... on DiscountAutomaticFreeShipping {
            title status summary startsAt endsAt
            recurringCycleLimit appliesOnOneTimePurchase appliesOnSubscription
            maximumShippingPrice { amount currencyCode }
            combinesWith { orderDiscounts productDiscounts shippingDiscounts }
            minimumRequirement {
              __typename
              ... on DiscountMinimumSubtotal {
                greaterThanOrEqualToSubtotal { amount currencyCode }
              }
              ... on DiscountMinimumQuantity {
                greaterThanOrEqualToQuantity
              }
            }
            destinationSelection {
              __typename
              ... on DiscountCountries {
                countries includeRestOfWorld
              }
              ... on DiscountCountryAll {
                allCountries
              }
            }
          }
        }
      }
    }
  }
}
`;

/**
 * Discount Code Basic - Create
 */
export const DISCOUNT_CODE_BASIC_CREATE = `
  mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Code Basic - Update
 */
export const DISCOUNT_CODE_BASIC_UPDATE = `
  mutation discountCodeBasicUpdate($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Code BXGY - Create
 */
export const DISCOUNT_CODE_BXGY_CREATE = `
  mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
    discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBxgy {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Code BXGY - Update
 */
export const DISCOUNT_CODE_BXGY_UPDATE = `
  mutation discountCodeBxgyUpdate($id: ID!, $bxgyCodeDiscount: DiscountCodeBxgyInput!) {
    discountCodeBxgyUpdate(id: $id, bxgyCodeDiscount: $bxgyCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBxgy {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Code Free Shipping - Create
 */
export const DISCOUNT_CODE_FREE_SHIPPING_CREATE = `
  mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeFreeShipping {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Code Free Shipping - Update
 */
export const DISCOUNT_CODE_FREE_SHIPPING_UPDATE = `
  mutation discountCodeFreeShippingUpdate($id: ID!, $freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingUpdate(id: $id, freeShippingCodeDiscount: $freeShippingCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeFreeShipping {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Automatic Basic - Create
 */
export const DISCOUNT_AUTOMATIC_BASIC_CREATE = `
  mutation discountAutomaticBasicCreate($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBasic {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Automatic Basic - Update
 */
export const DISCOUNT_AUTOMATIC_BASIC_UPDATE = `
  mutation discountAutomaticBasicUpdate($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBasic {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Automatic BXGY - Create
 */
export const DISCOUNT_AUTOMATIC_BXGY_CREATE = `
  mutation discountAutomaticBxgyCreate($automaticBxgyDiscount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyCreate(automaticBxgyDiscount: $automaticBxgyDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBxgy {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Automatic BXGY - Update
 */
export const DISCOUNT_AUTOMATIC_BXGY_UPDATE = `
  mutation discountAutomaticBxgyUpdate($id: ID!, $automaticBxgyDiscount: DiscountAutomaticBxgyInput!) {
    discountAutomaticBxgyUpdate(id: $id, automaticBxgyDiscount: $automaticBxgyDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticBxgy {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Automatic Free Shipping - Create
 */
export const DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE = `
  mutation discountAutomaticFreeShippingCreate($automaticFreeShippingDiscount: DiscountAutomaticFreeShippingInput!) {
    discountAutomaticFreeShippingCreate(automaticFreeShippingDiscount: $automaticFreeShippingDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticFreeShipping {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Discount Automatic Free Shipping - Update
 */
export const DISCOUNT_AUTOMATIC_FREE_SHIPPING_UPDATE = `
  mutation discountAutomaticFreeShippingUpdate($id: ID!, $automaticFreeShippingDiscount: DiscountAutomaticFreeShippingInput!) {
    discountAutomaticFreeShippingUpdate(id: $id, automaticFreeShippingDiscount: $automaticFreeShippingDiscount) {
      automaticDiscountNode {
        id
        automaticDiscount {
          ... on DiscountAutomaticFreeShipping {
            title
          }
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Markets
 */

/**
 * Markets - Query all markets with regions and web presences
 */
export const MARKETS_QUERY = `
  query markets($first: Int!, $after: String) {
    markets(first: $first, after: $after) {
      edges {
        node {
          id
          name
          handle
          enabled
          primary
          priceList {
            id
            name
            currency
          }
          regions(first: 250) {
            edges {
              node {
                id
                name
                ... on MarketRegionCountry {
                  code
                }
              }
            }
          }
          webPresences(first: 50) {
            edges {
              node {
                id
                domain {
                  id
                  host
                }
                subfolderSuffix
                alternateLocales {
                  locale
                }
                defaultLocale {
                  locale
                }
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Markets - Query single market by ID
 */
export const MARKET_QUERY = `
  query market($id: ID!) {
    market(id: $id) {
      id
      name
      handle
      enabled
      primary
      priceList {
        id
        name
        currency
      }
      regions(first: 250) {
        edges {
          node {
            id
            name
            ... on MarketRegionCountry {
              code
            }
          }
        }
      }
      webPresences(first: 50) {
        edges {
          node {
            id
            domain {
              id
              host
            }
            subfolderSuffix
            alternateLocales {
              locale
            }
            defaultLocale {
              locale
            }
          }
        }
      }
    }
  }
`;

/**
 * Market - Create
 */
export const MARKET_CREATE = `
  mutation marketCreate($input: MarketCreateInput!) {
    marketCreate(input: $input) {
      market {
        id
        name
        handle
        enabled
        primary
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market - Update
 */
export const MARKET_UPDATE = `
  mutation marketUpdate($id: ID!, $input: MarketUpdateInput!) {
    marketUpdate(id: $id, input: $input) {
      market {
        id
        name
        handle
        enabled
        primary
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market - Delete
 */
export const MARKET_DELETE = `
  mutation marketDelete($id: ID!) {
    marketDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market Localizations - Register regions to market
 */
export const MARKET_LOCALIZATIONS_REGISTER = `
  mutation marketLocalizationsRegister($marketId: ID!, $marketLocalizationsToCreate: [MarketLocalizationRegisterInput!]!) {
    marketLocalizationsRegister(
      marketId: $marketId
      marketLocalizationsToCreate: $marketLocalizationsToCreate
    ) {
      marketLocalizations {
        marketId
        key
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market Localizations - Remove regions from market
 */
export const MARKET_LOCALIZATIONS_REMOVE = `
  mutation marketLocalizationsRemove($marketLocalizationKeys: [MarketLocalizationKeyInput!]!, $marketId: ID!) {
    marketLocalizationsRemove(
      marketLocalizationKeys: $marketLocalizationKeys
      marketId: $marketId
    ) {
      removedIds
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market Web Presence - Create
 */
export const MARKET_WEB_PRESENCE_CREATE = `
  mutation marketWebPresenceCreate($marketId: ID!, $webPresence: MarketWebPresenceCreateInput!) {
    marketWebPresenceCreate(marketId: $marketId, webPresence: $webPresence) {
      marketWebPresence {
        id
        defaultLocale {
          locale
        }
        alternateLocales {
          locale
        }
        domain {
          id
          host
        }
        subfolderSuffix
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market Web Presence - Update
 */
export const MARKET_WEB_PRESENCE_UPDATE = `
  mutation marketWebPresenceUpdate($id: ID!, $webPresence: MarketWebPresenceUpdateInput!) {
    marketWebPresenceUpdate(id: $id, webPresence: $webPresence) {
      marketWebPresence {
        id
        defaultLocale {
          locale
        }
        alternateLocales {
          locale
        }
        domain {
          id
          host
        }
        subfolderSuffix
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * Market Web Presence - Delete
 */
export const MARKET_WEB_PRESENCE_DELETE = `
  mutation marketWebPresenceDelete($id: ID!) {
    marketWebPresenceDelete(id: $id) {
      deletedWebPresenceId
      userErrors {
        field
        message
        code
      }
    }
  }
`;
