import unittest

import generate_wechat_text_data as wechat_text
import xdu_canteen_importer as importer


class XduCanteenImporterTest(unittest.TestCase):
    def test_extract_window_blocks_handles_hash_ranges(self):
        blocks = importer.extract_window_blocks(
            [
                "1-10号窗口菜单",
                "1#-2# 麻辣香锅",
                "麻辣香锅（清香、微辣、中辣、特辣）",
                "3# 韩式烧肉饭",
                "韩式烧肉饭（原味、麻椒、香辣孜然）",
            ]
        )

        self.assertEqual(blocks[0]["windowNo"], "1-2")
        self.assertEqual(blocks[0]["windowName"], "麻辣香锅")
        self.assertEqual(blocks[1]["windowNo"], "3")
        self.assertEqual(blocks[1]["windowName"], "韩式烧肉饭")

    def test_ocr_line_parser_extracts_chinese_menu_prices(self):
        parsed = importer.dish_from_ocr_line("藤椒火腿土豆粉12元")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["dishName"], "藤椒火腿土豆粉")
        self.assertEqual(parsed["price"], 12)

    def test_ocr_line_parser_handles_decimal_unit_prices(self):
        parsed = importer.dish_from_ocr_line("豆皮海带夹馍2.5元/个")

        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["dishName"], "豆皮海带夹馍")
        self.assertEqual(parsed["price"], 2.5)

    def test_chinese_price_extraction(self):
        self.assertEqual(importer.extract_price("一元餐"), 1.0)
        self.assertEqual(importer.extract_price("十元套餐"), 10.0)

    def test_ocr_line_parser_splits_multiple_menu_prices(self):
        parsed = importer.dishes_from_ocr_line("菌菇煮馍··9元泡椒肉卷煮馍·10元培根·····3元鱼豆腐···3元")

        self.assertEqual(
            [(item["dishName"], item["price"]) for item in parsed],
            [("菌菇煮馍", 9), ("泡椒肉卷煮馍", 10)],
        )
        self.assertTrue(all("multi-price-line" in item["parseWarnings"] for item in parsed))

    def test_side_dishes_are_filtered_from_candidates(self):
        parsed = importer.dishes_from_ocr_line("米饭1元煎蛋1.5元培根3元鱼豆腐3元培根煮馍9元")

        self.assertEqual([(item["dishName"], item["price"]) for item in parsed], [("培根煮馍", 9)])
        self.assertTrue(importer.is_side_dish("米饭", 1))
        self.assertTrue(importer.is_side_dish("煎蛋", 1.5))
        self.assertFalse(importer.is_side_dish("番茄鸡蛋盖饭", 12))

    def test_ocr_line_parser_keeps_size_prices_separate(self):
        parsed = importer.dishes_from_ocr_line("鲜肉大馄饨10元（小）13元（大）")

        self.assertEqual(
            [(item["dishName"], item["price"]) for item in parsed],
            [("鲜肉大馄饨（小）", 10), ("鲜肉大馄饨（大）", 13)],
        )

    def test_noise_and_image_classification_skip_non_menu_content(self):
        self.assertTrue(importer.is_noise_line("光盘行动"))
        self.assertEqual(
            importer.classify_image(
                {
                    "lines": [
                        {"text": "海棠餐厅一楼美食集锦·导视图"},
                        {"text": "出入口"},
                        {"text": "上下楼梯"},
                    ]
                }
            ),
            "map",
        )
        self.assertEqual(importer.classify_image({"lines": [{"text": "藤椒火腿土豆粉12元"}]}), "menu")

    def test_dedupe_records_merges_same_window_dish_and_price(self):
        base = {
            "reviewStatus": "pending",
            "articleId": "haitang-1f",
            "windowNo": "01",
            "windowName": "测试窗口",
            "dishName": "菌菇煮馍",
            "price": 9,
            "sourceMethod": "ocr",
        }
        duplicate = {**base, "sourceMethod": "html-text", "sourceText": "菌菇煮馍9元"}

        records = importer.dedupe_records([base, duplicate])

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["duplicateCount"], 2)
        self.assertIn("duplicate-merged", records[0]["parseWarnings"])

    def test_wechat_text_cleaner_removes_flavor_options_and_bad_parentheses(self):
        cases = {
            "麻辣香锅（清香": "麻辣香锅",
            "韩式烧肉饭（原味": "韩式烧肉饭",
            "千岛类）香辣鸡腿饭": "香辣鸡腿饭",
            "鱼香茄子）": "鱼香茄子",
            "尖椒牛肉面(干拌)": "尖椒牛肉面",
            "炒（烩）麻食": "炒烩麻食",
        }

        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(wechat_text.clean_dish_name(raw), expected)

        for raw in ["麻辣", "番茄）", "金汤", "香辣味）", "酸辣等口味）", "三鲜）"]:
            with self.subTest(raw=raw):
                self.assertFalse(wechat_text.is_usable_dish(raw))


if __name__ == "__main__":
    unittest.main()
