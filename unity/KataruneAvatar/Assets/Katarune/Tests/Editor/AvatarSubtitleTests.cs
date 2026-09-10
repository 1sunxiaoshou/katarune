using System.Globalization;
using NUnit.Framework;

namespace Katarune.Avatar.Tests
{
    public class AvatarSubtitleTests
    {
        [TestCase("呼——总算动起来了！老师，你好。", "呼——总算动起来了！")]
        [TestCase("\n\n看，右手可以动了！\n\n怎么样？", "看，右手可以动了！")]
        [TestCase("她说：“你好！”接下来。", "她说：“你好！”")]
        [TestCase("第一段\n\n第二段", "第一段")]
        [TestCase("版本 3.14 可以用。下一句。", "版本 3.14 可以用。")]
        public void UsesNaturalBoundariesWithoutBlankLines(string input, string expected)
        {
            var page = AvatarControlConnection.ReadSubtitlePage(input, true, out var consumed, out var ready);
            Assert.That(page, Is.EqualTo(expected));
            Assert.That(ready, Is.True);
            Assert.That(consumed, Is.GreaterThan(0));
        }

        [Test]
        public void StreamingWaitsForClosingQuoteWithoutWaitingForWholeBlock()
        {
            var partial = AvatarControlConnection.ReadSubtitlePage("她说：“你好！", false, out _, out var ready);
            Assert.That(partial, Is.EqualTo("她说：“你好！"));
            Assert.That(ready, Is.False);
            var page = AvatarControlConnection.ReadSubtitlePage("她说：“你好！”下一句还在生成", false, out var consumed, out ready);
            Assert.That(page, Is.EqualTo("她说：“你好！”"));
            Assert.That(ready, Is.True);
            Assert.That(consumed, Is.EqualTo(page.Length));
        }

        [Test]
        public void LongUnpunctuatedTextIsBoundedAndPreservesUnicodeAndAllContent()
        {
            var input = string.Concat(System.Linq.Enumerable.Repeat("你好🌸e\u0301", 40));
            var remaining = input;
            var restored = "";
            while (remaining.Length > 0)
            {
                var page = AvatarControlConnection.ReadSubtitlePage(remaining, true, out var consumed, out var ready);
                Assert.That(ready, Is.True);
                Assert.That(new StringInfo(page).LengthInTextElements, Is.LessThanOrEqualTo(48));
                Assert.That(consumed, Is.GreaterThan(0));
                restored += page;
                remaining = remaining.Substring(consumed);
            }
            Assert.That(restored, Is.EqualTo(input));
        }
    }
}
